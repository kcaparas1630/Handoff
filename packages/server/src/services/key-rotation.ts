// Data-key rotation, re-encryption, retirement, and key-encryption-key rewrap
// (docs/pii-encryption.md, "Rotation, recovery, and deletion").
//
// Rotation itself is small: a successor content key becomes active and the old one becomes
// decrypt-only in one transaction, so new writes use the new key immediately and every existing
// row still reads. Converting the existing rows is background work the `rotate_data_keys` job
// does, table by table, in bounded batches.
//
// Invitation lookup keys are deliberately not rotated here. Changing a keyed equality index means
// recomputing every stored hash while both versions have to match, which is a serialized
// procedure with its own duplicate-blocking rules; docs/runbook.md documents it.
import { randomBytes } from "node:crypto";
import {
  dataKeyRepository,
  envelopeRepository,
  identityRepository,
  jobsRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { RotatableTable } from "@handoff/db";
import { workspaceScope } from "../lib/record-contexts";
import { decryptField, encryptField } from "../security/encryption/field-encryption";
import { ciphertextEnvelopeSchema } from "../schemas/ciphertext-envelope";
import { rotateDataKeysDedupeKey } from "./job-keys";
import type { KeyWrapper } from "../types/encryption";
import type { ServerRuntime, WorkerRuntime } from "../types/runtime";

const WRAPPING_CONTEXT_VERSION = 1;
const DATA_KEY_BYTES = 32;

/** Tables the workspace content key covers, in the order the job converts them. */
export const ROTATABLE_TABLES: readonly RotatableTable[] = [
  "children",
  "invitation_intents",
  "captures",
  "events",
  "event_revisions",
  "handoff_briefs",
  "idempotency_requests",
];

/** The record context each table's ciphertext is bound to. Getting this wrong fails the tag. */
function recordFor(table: RotatableTable, rowId: string[]) {
  const [id] = rowId;
  if (id === undefined) throw new Error("an envelope row id is empty");
  switch (table) {
    case "children":
      return { table: "children", rowId: id, column: "profile_ciphertext" };
    case "invitation_intents":
      return { table: "invitation_intents", rowId: id, column: "invitee_ciphertext" };
    case "captures":
      return { table: "captures", rowId: id, column: "content_ciphertext" };
    case "events":
      return { table: "events", rowId: id, column: "payload_ciphertext" };
    case "event_revisions":
      return { table: "event_revisions", rowId: id, column: "content_ciphertext" };
    case "handoff_briefs":
      return { table: "handoff_briefs", rowId: id, column: "snapshot_ciphertext" };
    case "idempotency_requests":
      return { table: "idempotency_requests", rowId, column: "response_ciphertext" };
  }
}

export interface RotationResult {
  previousKeyId: string;
  activeKeyId: string;
  version: number;
}

/**
 * Promotes a successor content key for one workspace. The partial unique index on the active state
 * decides a race, so two concurrent rotations cannot leave a scope with two active keys.
 */
export async function rotateWorkspaceContentKey({
  runtime,
  workspaceId,
}: {
  runtime: ServerRuntime;
  workspaceId: string;
}): Promise<RotationResult> {
  const scope = workspaceScope(workspaceId);
  const rotated = await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const current = await dataKeyRepository.findActiveDataKey(tx, scope, "content");
    if (current === null) throw new Error("this workspace has no active content key to rotate");

    const rawKey = randomBytes(DATA_KEY_BYTES);
    const wrapped = await runtime.keyWrapper.wrap(rawKey, {
      scope,
      purpose: "content",
      contextVersion: WRAPPING_CONTEXT_VERSION,
    });
    const successor = await dataKeyRepository.rotateActiveDataKey(tx, {
      previousKeyId: current.id,
      candidate: {
        scope,
        purpose: "content",
        version: current.version + 1,
        wrappedKey: wrapped.wrappedKey,
        wrappingProvider: runtime.keyWrapper.provider,
        wrappingKeyRef: wrapped.wrappingKeyRef,
        wrappingContextVersion: WRAPPING_CONTEXT_VERSION,
      },
    });
    if (successor === null) throw new Error("another rotation already replaced the active key");
    return { previous: current, successor };
  });

  // The conversion pass is background work: readers already support both versions.
  if (runtime.jobsDb !== null) {
    await withJobTransaction(runtime.jobsDb, (tx) =>
      jobsRepository.enqueueJob(tx, {
        kind: "rotate_data_keys",
        dedupeKey: rotateDataKeysDedupeKey(rotated.successor.id),
        workspaceId,
        payload: { workspaceId, previousKeyId: rotated.previous.id },
      }),
    );
  }
  return {
    previousKeyId: rotated.previous.id,
    activeKeyId: rotated.successor.id,
    version: rotated.successor.version,
  };
}

export interface ConversionResult {
  converted: number;
  /** Rows a concurrent edit rewrote between the read and the write. They need no second attempt. */
  skipped: number;
}

/**
 * Converts one batch of one table. Each row is decrypted under the key it names and re-encrypted
 * under the workspace's current active key; the update carries the key id and nonce that were
 * read, so a caregiver's correction in the meantime is never overwritten and no revision is
 * created. This is maintenance, not a correction: nothing allocates a journal sequence.
 */
export async function convertEnvelopeBatch({
  runtime,
  workspaceId,
  table,
  previousKeyId,
  limit,
}: {
  runtime: WorkerRuntime;
  workspaceId: string;
  table: RotatableTable;
  previousKeyId: string;
  limit: number;
}): Promise<ConversionResult> {
  const rows = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    envelopeRepository.listEnvelopeBatch(tx, { table, workspaceId, keyId: previousKeyId, limit }),
  );

  let converted = 0;
  let skipped = 0;
  for (const row of rows) {
    const parsed = ciphertextEnvelopeSchema.safeParse(row.envelope);
    if (!parsed.success)
      throw new Error(`a ${table} envelope is not a supported ciphertext record`);
    const record = recordFor(table, row.rowId);
    const scope = workspaceScope(workspaceId);
    const payload = await decryptField({
      keys: runtime.keys,
      scope,
      record,
      envelope: row.envelope,
    });
    const envelope = await encryptField({ keys: runtime.keys, scope, record, payload });

    const wrote = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
      envelopeRepository.replaceEnvelope(tx, {
        table,
        workspaceId,
        rowId: row.rowId,
        expectedKeyId: parsed.data.keyId,
        expectedNonce: parsed.data.nonce,
        envelope,
      }),
    );
    if (wrote) converted += 1;
    else skipped += 1;
  }
  return { converted, skipped };
}

/**
 * Retirement is refused while anything still reads the key. A retired key cannot be unwrapped for
 * decryption at all, so this is the one irreversible step and it checks every covered table.
 */
export async function retireWorkspaceKeyIfUnused({
  runtime,
  workspaceId,
  keyId,
}: {
  runtime: ServerRuntime;
  workspaceId: string;
  keyId: string;
}): Promise<boolean> {
  return withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    for (const table of ROTATABLE_TABLES) {
      const remaining = await envelopeRepository.countEnvelopesForKey(tx, {
        table,
        workspaceId,
        keyId,
      });
      if (remaining > 0) return false;
    }
    return (await dataKeyRepository.retireDataKey(tx, keyId)) !== null;
  });
}

/**
 * Demotes a deleted workspace's scope keys so nothing new can be encrypted under them, and retires
 * them only once the retention window has passed. The second step is deliberately not scheduled by
 * this function: retiring a key that a retained backup still needs is unrecoverable, so an
 * operator runs the sweep (docs/runbook.md, "Retention windows").
 */
export async function retireWorkspaceKeysIfDue({
  runtime,
  workspaceId,
}: {
  runtime: ServerRuntime;
  workspaceId: string;
}): Promise<{ demoted: number; retired: number }> {
  const workspace = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    identityRepository.findWorkspaceById(tx, workspaceId),
  );
  const keys = await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => [
    ...(await dataKeyRepository.listDataKeysForScope(tx, workspaceScope(workspaceId), "content")),
    ...(await dataKeyRepository.listDataKeysForScope(tx, workspaceScope(workspaceId), "lookup")),
  ]);

  let demoted = 0;
  for (const key of keys) {
    if (key.state !== "active") continue;
    await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
      dataKeyRepository.markDataKeyDecryptOnly(tx, key.id),
    );
    demoted += 1;
  }

  const deletedAt = workspace?.deletedAt ?? null;
  if (deletedAt === null || !retentionElapsed(deletedAt, runtime)) return { demoted, retired: 0 };

  let retired = 0;
  for (const key of keys) {
    if (key.state === "retired") continue;
    if (await retireWorkspaceKeyIfUnused({ runtime, workspaceId, keyId: key.id })) retired += 1;
  }
  return { demoted, retired };
}

function retentionElapsed(deletedAt: Date, runtime: ServerRuntime): boolean {
  const elapsedMs = runtime.now().getTime() - deletedAt.getTime();
  return elapsedMs >= runtime.limits.workspaceKeyRetentionDays * 24 * 60 * 60 * 1000;
}

export interface RewrapResult {
  rewrapped: number;
  unchanged: number;
}

/**
 * Key-encryption-key rewrap. Every wrapped data key is unwrapped with the wrapper that can still
 * read it and re-wrapped with the current one; no stored ciphertext changes, which is the point of
 * envelope encryption. With one development key this is a no-op that still exercises the path;
 * with a new KMS key id it is the migration.
 */
export async function rewrapDataKeys({
  runtime,
  previousWrapper,
  limit = 1_000,
}: {
  runtime: ServerRuntime;
  /** The wrapper that can unwrap the existing records, when it is not the current one. */
  previousWrapper?: KeyWrapper;
  limit?: number;
}): Promise<RewrapResult> {
  const keys = await runtime.db.transaction((tx) => dataKeyRepository.listAllDataKeys(tx, limit));
  const unwrapWith = previousWrapper ?? runtime.keyWrapper;

  let rewrapped = 0;
  let unchanged = 0;
  for (const key of keys) {
    if (key.state === "retired") {
      unchanged += 1;
      continue;
    }
    const context = {
      scope: key.scope,
      purpose: key.purpose,
      contextVersion: key.wrappingContextVersion,
    };
    const rawKey = await unwrapWith.unwrap(key.wrappedKey, context);
    const wrapped = await runtime.keyWrapper.wrap(rawKey, {
      ...context,
      contextVersion: WRAPPING_CONTEXT_VERSION,
    });
    await runtime.db.transaction((tx) =>
      dataKeyRepository.updateWrappedDataKey(tx, {
        keyId: key.id,
        wrappedKey: wrapped.wrappedKey,
        wrappingProvider: runtime.keyWrapper.provider,
        wrappingKeyRef: wrapped.wrappingKeyRef,
        wrappingContextVersion: WRAPPING_CONTEXT_VERSION,
      }),
    );
    rewrapped += 1;
  }
  return { rewrapped, unchanged };
}
