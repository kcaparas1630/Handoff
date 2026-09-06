import { randomBytes, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  CiphertextEnvelope,
  EncryptionScope,
  KeyWrapper,
  RecordContext,
} from "../../types/encryption";
import { createDataKeyService } from "./data-keys";
import type { DataKeyService } from "./data-keys";
import { createDevelopmentKeyWrapper } from "./development-key-wrapper";
import { decryptField, encryptField } from "./field-encryption";
import { EncryptionError } from "./errors";
import type { EncryptionErrorCode } from "./errors";
import { createInMemoryDataKeyStore } from "./test-support/in-memory-data-key-store";
import type { InMemoryDataKeyStore } from "./test-support/in-memory-data-key-store";

const workspace: EncryptionScope = {
  kind: "workspace",
  workspaceId: "11111111-1111-4111-8111-111111111111",
};
const otherWorkspace: EncryptionScope = {
  kind: "workspace",
  workspaceId: "99999999-9999-4999-8999-999999999999",
};
const record: RecordContext = {
  table: "events",
  rowId: "22222222-2222-4222-8222-222222222222",
  column: "payload_ciphertext",
};
const payload = { schemaVersion: 1, amount: 120, unit: "ml", note: "took most of the bottle" };

function developmentWrapper(): KeyWrapper {
  return createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
}

async function expectFailure(
  run: () => Promise<unknown>,
  code: EncryptionErrorCode,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof EncryptionError)) throw error;
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("bottle");
    return;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describe("field encryption", () => {
  let store: InMemoryDataKeyStore;
  let keys: DataKeyService;

  beforeEach(() => {
    store = createInMemoryDataKeyStore();
    keys = createDataKeyService({ store, wrapper: developmentWrapper() });
  });

  it("round trips a payload and stores no plaintext in the envelope", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });

    expect(envelope.formatVersion).toBe(1);
    expect(envelope.algorithm).toBe("A256GCM");
    expect(JSON.stringify(envelope)).not.toContain("bottle");
    await expect(decryptField({ keys, scope: workspace, record, envelope })).resolves.toEqual(
      payload,
    );
  });

  it.each([
    ["row", { ...record, rowId: "33333333-3333-4333-8333-333333333333" }],
    ["column", { ...record, column: "content_ciphertext" }],
    ["table", { ...record, table: "captures" }],
  ])("fails when the envelope is replayed on another %s", async (_label, movedRecord) => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });

    await expectFailure(
      () => decryptField({ keys, scope: workspace, record: movedRecord, envelope }),
      "authentication_failed",
    );
  });

  it("fails when the envelope is replayed under another workspace scope", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });

    await expectFailure(
      () => decryptField({ keys, scope: otherWorkspace, record, envelope }),
      "key_scope_mismatch",
    );
  });

  it.each([
    [
      "bad base64 ciphertext",
      (envelope: CiphertextEnvelope) => ({ ...envelope, ciphertext: "not base64!!" }),
    ],
    [
      "a short nonce",
      (envelope: CiphertextEnvelope) => ({
        ...envelope,
        nonce: Buffer.alloc(8).toString("base64"),
      }),
    ],
    [
      "a short tag",
      (envelope: CiphertextEnvelope) => ({ ...envelope, tag: Buffer.alloc(12).toString("base64") }),
    ],
    [
      "an unsupported version",
      (envelope: CiphertextEnvelope) => ({ ...envelope, formatVersion: 2 }),
    ],
    [
      "an unsupported algorithm",
      (envelope: CiphertextEnvelope) => ({ ...envelope, algorithm: "A128GCM" }),
    ],
    [
      "an extra key",
      (envelope: CiphertextEnvelope) => ({ ...envelope, plaintext: "took most of the bottle" }),
    ],
  ])("rejects an envelope with %s", async (_label, corrupt) => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });

    await expectFailure(
      () => decryptField({ keys, scope: workspace, record, envelope: corrupt(envelope) }),
      "invalid_envelope",
    );
  });

  it("keeps decrypting with a decrypt-only key but does not select it for new writes", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });
    store.setState(envelope.keyId, "decrypt_only");

    await expect(decryptField({ keys, scope: workspace, record, envelope })).resolves.toEqual(
      payload,
    );

    const next = await encryptField({ keys, scope: workspace, record, payload });
    expect(next.keyId).not.toBe(envelope.keyId);
    expect(store.rows()).toHaveLength(2);
  });

  it("fails closed once the key is retired", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });
    store.setState(envelope.keyId, "retired");

    await expectFailure(
      () => decryptField({ keys, scope: workspace, record, envelope }),
      "key_unavailable",
    );
  });

  it("fails when the referenced key row is missing", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });

    await expectFailure(
      () =>
        decryptField({
          keys,
          scope: workspace,
          record,
          envelope: { ...envelope, keyId: randomUUID() },
        }),
      "key_unavailable",
    );
  });

  it("surfaces a wrapper failure without plaintext", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });
    const brokenWrapper: KeyWrapper = {
      provider: "broken",
      wrap: () => Promise.reject(new Error("kms is down")),
      unwrap: () => Promise.reject(new Error("kms is down")),
    };
    const brokenKeys = createDataKeyService({ store, wrapper: brokenWrapper });

    await expectFailure(
      () => decryptField({ keys: brokenKeys, scope: workspace, record, envelope }),
      "wrapper_failure",
    );
  });

  it("stops at the per-key encryption budget instead of exceeding it", async () => {
    const budgeted = createDataKeyService({
      store,
      wrapper: developmentWrapper(),
      encryptionBudget: 2,
    });

    await encryptField({ keys: budgeted, scope: workspace, record, payload });
    await encryptField({ keys: budgeted, scope: workspace, record, payload });

    await expectFailure(
      () => encryptField({ keys: budgeted, scope: workspace, record, payload }),
      "budget_exceeded",
    );
  });

  it("provisions one key when two first writes race", async () => {
    const inner = developmentWrapper();
    let wrapCalls = 0;
    const countingWrapper: KeyWrapper = {
      provider: inner.provider,
      wrap: (rawKey, context) => {
        wrapCalls += 1;
        return inner.wrap(rawKey, context);
      },
      unwrap: (wrappedKey, context) => inner.unwrap(wrappedKey, context),
    };
    const racing = createDataKeyService({ store, wrapper: countingWrapper });

    const [first, second] = await Promise.all([
      encryptField({ keys: racing, scope: workspace, record, payload }),
      encryptField({
        keys: racing,
        scope: workspace,
        record: { ...record, column: "content_ciphertext" },
        payload,
      }),
    ]);

    // Both callers generated a candidate; only the winning row is persisted and used.
    expect(wrapCalls).toBe(2);
    expect(second.keyId).toBe(first.keyId);
    expect(store.rows()).toHaveLength(1);
    await expect(
      decryptField({ keys: racing, scope: workspace, record, envelope: first }),
    ).resolves.toEqual(payload);
  });

  it("authenticates every read rather than reusing an earlier result", async () => {
    const envelope = await encryptField({ keys, scope: workspace, record, payload });
    await expect(decryptField({ keys, scope: workspace, record, envelope })).resolves.toEqual(
      payload,
    );

    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    ciphertext.writeUInt8(ciphertext.readUInt8(0) ^ 0x01, 0);

    await expectFailure(
      () =>
        decryptField({
          keys,
          scope: workspace,
          record,
          envelope: { ...envelope, ciphertext: ciphertext.toString("base64") },
        }),
      "authentication_failed",
    );
  });
});
