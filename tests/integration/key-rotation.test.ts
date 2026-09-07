// The encryption contract's rotation requirements (docs/pii-encryption.md, "Required verification"
// items 6 and 7): a rotated scope keeps reading old records, new writes use the successor, the
// re-encryption job converts every covered table, a concurrent correction is never overwritten and
// creates no maintenance revision, retirement is refused while anything still references the key,
// and a key-encryption-key rewrap leaves every record readable.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as childrenRepository from "../../packages/db/src/repositories/children";
import * as dataKeyRepository from "../../packages/db/src/repositories/data-keys";
import * as envelopeRepository from "../../packages/db/src/repositories/envelopes";
import * as eventsRepository from "../../packages/db/src/repositories/events";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { createDataKeyService } from "../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../packages/server/src/security/encryption/development-key-wrapper";
import { ciphertextEnvelopeSchema } from "../../packages/server/src/schemas/ciphertext-envelope";
import { getChild, updateChild } from "../../packages/server/src/services/children";
import { createBrief } from "../../packages/server/src/services/handoffs";
import { createInvitation } from "../../packages/server/src/services/invitations";
import {
  ROTATABLE_TABLES,
  retireWorkspaceKeyIfUnused,
  rewrapDataKeys,
  rotateWorkspaceContentKey,
} from "../../packages/server/src/services/key-rotation";
import { rotateDataKeys } from "../../packages/server/src/jobs/rotate-data-keys";
import { createJobHarness } from "./support/job-harness";
import { candidate, confirmManualCapture } from "./support/journal-fixtures";
import { createHarness, seedChild, seedWorkspace } from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { RotatableTable } from "../../packages/db/src/types/envelopes";
import type { ServerRuntime } from "../../packages/server/src/types/runtime";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping key rotation tests. ${missingDatabaseUrlMessage}`);

describeIntegration("data key rotation", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let ownerId: string;
  let childId: string;
  let previousKeyId: string;
  let activeKeyId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "rotate" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, {
      workspaceId,
      ownerId,
      name: "Marker-Rotate",
      birthdate: "2023-02-02",
    });
    // One row in as many covered tables as the fixtures reach, so the conversion has real work.
    await confirmManualCapture(harness, {
      actorUserId: ownerId,
      childId,
      candidates: [candidate({ kind: "feed" })],
    });
    await createBrief({ deps: harness.deps, actorUserId: ownerId, childId });
    await createInvitation({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: "rotate-invitee@example.test",
        intendedAppRole: "caregiver",
        childGrants: [{ childId, relationship: "caregiver", permission: "reader" }],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  /** The harness's service dependencies read as a process runtime, which rotation expects. */
  function serverRuntime(overrides: Partial<ServerRuntime> = {}): ServerRuntime {
    return { ...harness.deps, close: () => Promise.resolve(), ...overrides };
  }

  function readChildRow() {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      childrenRepository.findChildInWorkspace(tx, workspaceId, childId),
    );
  }

  function envelopeKeyId(envelope: unknown): string {
    return ciphertextEnvelopeSchema.parse(envelope).keyId;
  }

  function countOnKey(table: RotatableTable, keyId: string): Promise<number> {
    return withTenantTransaction(
      harness.deps.db,
      { workspaceId },
      async (tx) =>
        (await envelopeRepository.listEnvelopeBatch(tx, { table, workspaceId, keyId, limit: 100 }))
          .length,
    );
  }

  async function countRemainingOnPreviousKey(): Promise<number> {
    let total = 0;
    for (const table of ROTATABLE_TABLES) total += await countOnKey(table, previousKeyId);
    return total;
  }

  /** Claims and runs the queued rotation job the way the worker does. */
  function runRotation(): Promise<number> {
    return jobs.runner.runOnce();
  }

  it("promotes a successor key, keeps old rows readable, and writes new ciphertext under it", async () => {
    const before = await readChildRow();
    previousKeyId = envelopeKeyId(before?.profileCiphertext);

    const rotated = await rotateWorkspaceContentKey({ runtime: serverRuntime(), workspaceId });
    activeKeyId = rotated.activeKeyId;
    expect(rotated.previousKeyId).toBe(previousKeyId);
    expect(rotated.version).toBe(2);

    // The old key still reads: nothing was rewritten by the rotation itself.
    const child = await getChild({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(child.name).toBe("Marker-Rotate");
    expect(envelopeKeyId((await readChildRow())?.profileCiphertext)).toBe(previousKeyId);

    // A new write picks the active key without anyone telling it which one that is.
    const second = await seedChild(harness, { workspaceId, ownerId, name: "Marker-Rotate-Second" });
    const secondRow = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      childrenRepository.findChildInWorkspace(tx, workspaceId, second),
    );
    expect(envelopeKeyId(secondRow?.profileCiphertext)).toBe(activeKeyId);

    const keys = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      dataKeyRepository.listDataKeysForScope(tx, { kind: "workspace", workspaceId }, "content"),
    );
    expect(keys.map((key) => key.state)).toEqual(["active", "decrypt_only"]);
  });

  it("refuses to retire the old key while envelopes still name it", async () => {
    expect(await countRemainingOnPreviousKey()).toBeGreaterThan(0);
    expect(
      await retireWorkspaceKeyIfUnused({
        runtime: serverRuntime(),
        workspaceId,
        keyId: previousKeyId,
      }),
    ).toBe(false);
  });

  it("never overwrites a correction made between the batch read and its write", async () => {
    const before = await readChildRow();
    if (before === null) throw new Error("expected the child row");
    const stale = ciphertextEnvelopeSchema.parse(before.profileCiphertext);

    // The caregiver's edit lands first, under the active key, exactly as an ordinary write does.
    await updateChild({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
      input: { name: "Marker-Rotate-Corrected", expectedVersion: before.version },
    });

    // The maintenance write still carries the envelope it read, so it matches nothing.
    const wrote = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      envelopeRepository.replaceEnvelope(tx, {
        table: "children",
        workspaceId,
        rowId: [childId],
        expectedKeyId: stale.keyId,
        expectedNonce: stale.nonce,
        envelope: before.profileCiphertext,
      }),
    );
    expect(wrote).toBe(false);

    const corrected = await getChild({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(corrected.name).toBe("Marker-Rotate-Corrected");
  });

  it("converts every covered table without creating a revision, and repeats without duplicating", async () => {
    const journalBefore = (await readChildRow())?.journalSeq ?? 0;
    const revisionsBefore = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      eventsRepository.listRevisionsInWindow(tx, childId, 0, journalBefore),
    );

    expect(await runRotation()).toBeGreaterThan(0);
    expect(await countRemainingOnPreviousKey()).toBe(0);

    // Re-encryption is maintenance: it publishes nothing, so the child's counter never moves.
    const after = await readChildRow();
    expect(after?.journalSeq).toBe(journalBefore);
    const revisionsAfter = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      eventsRepository.listRevisionsInWindow(tx, childId, 0, journalBefore),
    );
    expect(revisionsAfter.map((row) => row.id)).toEqual(revisionsBefore.map((row) => row.id));

    // Everything still reads, now under the successor key.
    const child = await getChild({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(child.name).toBe("Marker-Rotate-Corrected");
    expect(child.birthdate).toBe("2023-02-02");

    // A resumed attempt after a crash finds no work left and writes nothing a second time.
    const resumed = await rotateDataKeys({
      runtime: jobs.runtime,
      job: {
        id: randomUUID(),
        kind: "rotate_data_keys",
        dedupeKey: `rotate:${randomUUID()}`,
        status: "leased",
        workspaceId,
        childId: null,
        captureId: null,
        assetId: null,
        payload: { workspaceId, previousKeyId },
        checkpoint: { stage: "rotate", table: "captures", converted: 1 },
        attempts: 2,
        maxAttempts: 3,
        availableAt: new Date(),
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        lastErrorCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      leaseToken: randomUUID(),
      saveCheckpoint: () => Promise.resolve(true),
    });
    expect(resumed).toEqual({ status: "completed" });
    expect((await readChildRow())?.journalSeq).toBe(journalBefore);
  });

  it("retires the old key once nothing references it", async () => {
    expect(await countRemainingOnPreviousKey()).toBe(0);
    expect(
      await retireWorkspaceKeyIfUnused({
        runtime: serverRuntime(),
        workspaceId,
        keyId: previousKeyId,
      }),
    ).toBe(true);

    const keys = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      dataKeyRepository.listDataKeysForScope(tx, { kind: "workspace", workspaceId }, "content"),
    );
    expect(keys.find((key) => key.id === previousKeyId)?.state).toBe("retired");
  });

  it("keeps every record readable after the wrapping key is replaced", async () => {
    const secondKek = createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
    const result = await rewrapDataKeys({
      runtime: serverRuntime({ keyWrapper: secondKek }),
      previousWrapper: harness.deps.keyWrapper,
    });
    expect(result.rewrapped).toBeGreaterThan(0);

    // Nothing stored changed except the wrapped keys, so a service built on the new wrapping key
    // reads records that were written long before it existed.
    const rewrapped = createDataKeyService({
      store: createDataKeyStore(harness.deps.db),
      wrapper: secondKek,
    });
    const child = await getChild({
      deps: { ...harness.deps, keys: rewrapped },
      actorUserId: ownerId,
      workspaceId,
      childId,
    });
    expect(child.name).toBe("Marker-Rotate-Corrected");

    // Put the harness back on a key service that can read what it will write next.
    harness.deps.keys = rewrapped;
    harness.deps.keyWrapper = secondKek;
  });
});
