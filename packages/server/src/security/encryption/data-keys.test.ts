import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DataKeyRecord,
  EncryptionScope,
  KeyWrapper,
  RecordContext,
} from "../../types/encryption";
import { decryptAesGcm } from "./aes-gcm";
import { createDataKeyService } from "./data-keys";
import type { DataKeyService } from "./data-keys";
import { createDevelopmentKeyWrapper } from "./development-key-wrapper";
import { encryptField } from "./field-encryption";
import { EncryptionError } from "./errors";
import { encodeAdditionalData } from "./lib/encryption-context";
import { createInMemoryDataKeyStore } from "./test-support/in-memory-data-key-store";
import type { InMemoryDataKeyStore } from "./test-support/in-memory-data-key-store";

const workspace: EncryptionScope = {
  kind: "workspace",
  workspaceId: "11111111-1111-4111-8111-111111111111",
};
const record: RecordContext = {
  table: "invitation_intents",
  rowId: "22222222-2222-4222-8222-222222222222",
  column: "invitee_ciphertext",
};

describe("data key service", () => {
  let store: InMemoryDataKeyStore;
  let wrapper: KeyWrapper;
  let keys: DataKeyService;

  beforeEach(() => {
    store = createInMemoryDataKeyStore();
    wrapper = createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
    keys = createDataKeyService({ store, wrapper });
  });

  async function seedLookupRow(): Promise<DataKeyRecord> {
    const lookup = await keys.getLookupKey(workspace);
    const row = store.rows().find((candidate) => candidate.id === lookup.keyId);
    if (row === undefined) throw new Error("expected a persisted lookup key");
    return row;
  }

  it("returns a stable lookup key across calls", async () => {
    const first = await keys.getLookupKey(workspace);
    const second = await keys.getLookupKey(workspace);

    expect(second.keyId).toBe(first.keyId);
    expect(second.key.equals(first.key)).toBe(true);
    expect(store.rows()).toHaveLength(1);
  });

  it("does not reserve encryption usage for lookup keys", async () => {
    await keys.getLookupKey(workspace);
    await keys.getLookupKey(workspace);

    const rows = store.rows();
    expect(rows.map((row) => row.purpose)).toEqual(["lookup"]);
    expect(rows.map((row) => row.reservedEncryptions)).toEqual([0]);
  });

  it("reserves usage for content keys only", async () => {
    await keys.getEncryptionKey(workspace);
    await keys.getLookupKey(workspace);

    const content = store.rows().find((row) => row.purpose === "content");
    const lookup = store.rows().find((row) => row.purpose === "lookup");
    expect(content?.reservedEncryptions).toBe(1);
    expect(lookup?.reservedEncryptions).toBe(0);
  });

  it("keeps content and lookup keys in separate rows with different material", async () => {
    const content = await keys.getEncryptionKey(workspace);
    const lookup = await keys.getLookupKey(workspace);

    expect(lookup.keyId).not.toBe(content.keyId);
    expect(lookup.key.equals(content.key)).toBe(false);
    expect(store.rows()).toHaveLength(2);
  });

  it("provisions one lookup key when two first uses race", async () => {
    const [first, second] = await Promise.all([
      keys.getLookupKey(workspace),
      keys.getLookupKey(workspace),
    ]);

    expect(second.keyId).toBe(first.keyId);
    expect(store.rows()).toHaveLength(1);
  });

  // Lookup keys are not rotated silently; a stale row must fail rather than be used.
  it("rejects a store row that is not active", async () => {
    const row = await seedLookupRow();
    const stale = createDataKeyService({
      store: { ...store, findActiveKey: () => Promise.resolve({ ...row, state: "decrypt_only" }) },
      wrapper,
    });

    await expect(stale.getLookupKey(workspace)).rejects.toMatchObject({ code: "key_not_active" });
  });

  it("rejects a store row from another scope", async () => {
    const row = await seedLookupRow();
    const foreign = createDataKeyService({
      store: {
        ...store,
        findActiveKey: () =>
          Promise.resolve({
            ...row,
            scope: { kind: "workspace", workspaceId: "99999999-9999-4999-8999-999999999999" },
          }),
      },
      wrapper,
    });

    await expect(foreign.getLookupKey(workspace)).rejects.toMatchObject({
      code: "key_scope_mismatch",
    });
  });

  it("cannot decrypt a content envelope with the lookup key", async () => {
    const envelope = await encryptField({
      keys,
      scope: workspace,
      record,
      payload: { schemaVersion: 1, email: "parent@example.com" },
    });
    const lookup = await keys.getLookupKey(workspace);

    // The scope matches; only the key material differs, so GCM authentication fails.
    expect(() =>
      decryptAesGcm(
        {
          nonce: Buffer.from(envelope.nonce, "base64"),
          ciphertext: Buffer.from(envelope.ciphertext, "base64"),
          tag: Buffer.from(envelope.tag, "base64"),
        },
        lookup.key,
        encodeAdditionalData({
          scope: workspace,
          record,
          formatVersion: envelope.formatVersion,
          keyId: envelope.keyId,
        }),
      ),
    ).toThrowError(EncryptionError);
  });
});
