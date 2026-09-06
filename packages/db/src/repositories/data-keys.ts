import { and, eq, isNull, sql } from "drizzle-orm";
import { dataKeys } from "../schema";
import type { HandoffDatabase, HandoffTransaction } from "../types/database";
import type {
  DataKeyPurpose,
  DataKeyRow,
  DataKeyScope,
  DataKeyStorePort,
  NewDataKey,
} from "../types/data-keys";

interface DataKeyColumns {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  purpose: DataKeyPurpose;
  version: number;
  wrappedKey: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
  wrappingContextVersion: number;
  state: DataKeyRow["state"];
  reservedEncryptions: number;
}

function toDataKeyRow(row: DataKeyColumns): DataKeyRow {
  const scope: DataKeyScope | null =
    row.workspaceId !== null
      ? { kind: "workspace", workspaceId: row.workspaceId }
      : row.userId !== null
        ? { kind: "user", userId: row.userId }
        : null;
  if (!scope) throw new Error(`data_keys row ${row.id} has no scope`);
  return {
    id: row.id,
    scope,
    purpose: row.purpose,
    version: row.version,
    wrappedKey: row.wrappedKey,
    wrappingProvider: row.wrappingProvider,
    wrappingKeyRef: row.wrappingKeyRef,
    wrappingContextVersion: row.wrappingContextVersion,
    state: row.state,
    reservedEncryptions: row.reservedEncryptions,
  };
}

function scopeMatches(scope: DataKeyScope) {
  if (scope.kind === "workspace") {
    return and(eq(dataKeys.workspaceId, scope.workspaceId), isNull(dataKeys.userId));
  }
  return and(eq(dataKeys.userId, scope.userId), isNull(dataKeys.workspaceId));
}

function scopeColumns(scope: DataKeyScope) {
  return scope.kind === "workspace"
    ? { workspaceId: scope.workspaceId, userId: null }
    : { workspaceId: null, userId: scope.userId };
}

export async function findActiveDataKey(
  tx: HandoffTransaction,
  scope: DataKeyScope,
  purpose: DataKeyPurpose,
): Promise<DataKeyRow | null> {
  const [row] = await tx
    .select()
    .from(dataKeys)
    .where(and(scopeMatches(scope), eq(dataKeys.purpose, purpose), eq(dataKeys.state, "active")))
    .limit(1);
  return row ? toDataKeyRow(row) : null;
}

export async function findDataKeyById(
  tx: HandoffTransaction,
  id: string,
): Promise<DataKeyRow | null> {
  const [row] = await tx.select().from(dataKeys).where(eq(dataKeys.id, id)).limit(1);
  return row ? toDataKeyRow(row) : null;
}

/**
 * Concurrent first use of a scope races on the partial unique active index: the losers insert
 * nothing and read the winner's row, so a scope never has two active keys.
 */
export async function insertActiveDataKeyIfAbsent(
  tx: HandoffTransaction,
  candidate: NewDataKey,
): Promise<DataKeyRow> {
  const [inserted] = await tx
    .insert(dataKeys)
    .values({
      ...scopeColumns(candidate.scope),
      purpose: candidate.purpose,
      version: candidate.version,
      wrappedKey: candidate.wrappedKey,
      wrappingProvider: candidate.wrappingProvider,
      wrappingKeyRef: candidate.wrappingKeyRef,
      wrappingContextVersion: candidate.wrappingContextVersion,
      state: "active",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return toDataKeyRow(inserted);

  const existing = await findActiveDataKey(tx, candidate.scope, candidate.purpose);
  if (!existing) {
    throw new Error("data key insert conflicted but no active key is present for the scope");
  }
  return existing;
}

/** Reserves usage against the active key's budget. A decrypt-only key can never be selected. */
export async function reserveDataKeyEncryptions(
  tx: HandoffTransaction,
  keyId: string,
  count: number,
): Promise<number> {
  const [row] = await tx
    .update(dataKeys)
    .set({
      reservedEncryptions: sql`${dataKeys.reservedEncryptions} + ${count}`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(dataKeys.id, keyId), eq(dataKeys.state, "active")))
    .returning({ reservedEncryptions: dataKeys.reservedEncryptions });
  if (!row) throw new Error(`data key ${keyId} is not active and cannot reserve encryptions`);
  return row.reservedEncryptions;
}

/**
 * Binds the repository into the server's key store port. Key provisioning precedes the tenant
 * transaction that needs the key, so these run as their own short transactions; `data_keys` is
 * deliberately not under tenant row-level security.
 */
export function createDataKeyStore(db: HandoffDatabase): DataKeyStorePort {
  return {
    findActiveKey: (scope, purpose) =>
      db.transaction((tx) => findActiveDataKey(tx, scope, purpose)),
    findKeyById: (id) => db.transaction((tx) => findDataKeyById(tx, id)),
    insertActiveKeyIfAbsent: (candidate) =>
      db.transaction((tx) => insertActiveDataKeyIfAbsent(tx, candidate)),
    reserveEncryptions: (keyId, count) =>
      db.transaction((tx) => reserveDataKeyEncryptions(tx, keyId, count)),
  };
}
