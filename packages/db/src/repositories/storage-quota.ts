import { and, eq, sql } from "drizzle-orm";
import { workspaces } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type { WorkspaceStorageRow } from "../types/media";

// Reserved plus stored bytes are compared against the workspace budget before an upload token is
// issued. The workspace row's own updated_at and version stay put: moving quota is not a profile
// edit, and bumping the version would break optimistic concurrency for callers editing the name.

const storageColumns = {
  workspaceId: workspaces.id,
  budgetBytes: workspaces.storageBudgetBytes,
  reservedBytes: workspaces.storageReservedBytes,
  usedBytes: workspaces.storageUsedBytes,
};

/**
 * Returns null when the reservation would exceed the budget. The check lives in the UPDATE
 * predicate rather than a preceding SELECT: concurrent reservations serialize on the workspace
 * row, and the loser re-evaluates the predicate against the winner's totals.
 */
export async function reserveStorageBytes(
  tx: HandoffTransaction,
  input: { workspaceId: string; bytes: number },
): Promise<WorkspaceStorageRow | null> {
  const [row] = await tx
    .update(workspaces)
    .set({ storageReservedBytes: sql`${workspaces.storageReservedBytes} + ${input.bytes}` })
    .where(
      and(
        eq(workspaces.id, input.workspaceId),
        sql`${workspaces.storageReservedBytes} + ${workspaces.storageUsedBytes} + ${input.bytes} <= ${workspaces.storageBudgetBytes}`,
      ),
    )
    .returning(storageColumns);
  return row ?? null;
}

/**
 * Moves a validated asset's bytes from reserved to used. Call only when the asset's own
 * transition returned a row, in the same transaction; that transition is the once-only guard.
 * The actual size may differ from the reservation, so both numbers are passed.
 */
export async function settleStorageBytes(
  tx: HandoffTransaction,
  input: { workspaceId: string; reservedBytes: number; actualBytes: number },
): Promise<WorkspaceStorageRow | null> {
  const [row] = await tx
    .update(workspaces)
    .set({
      // greatest() keeps a counter that drifted through manual repair from going negative.
      storageReservedBytes: sql`greatest(${workspaces.storageReservedBytes} - ${input.reservedBytes}, 0)`,
      storageUsedBytes: sql`${workspaces.storageUsedBytes} + ${input.actualBytes}`,
    })
    .where(eq(workspaces.id, input.workspaceId))
    .returning(storageColumns);
  return row ?? null;
}

/** Gives back a reservation that never became stored bytes: an expired or rejected upload. */
export async function releaseStorageBytes(
  tx: HandoffTransaction,
  input: { workspaceId: string; reservedBytes: number },
): Promise<WorkspaceStorageRow | null> {
  const [row] = await tx
    .update(workspaces)
    .set({
      storageReservedBytes: sql`greatest(${workspaces.storageReservedBytes} - ${input.reservedBytes}, 0)`,
    })
    .where(eq(workspaces.id, input.workspaceId))
    .returning(storageColumns);
  return row ?? null;
}

/**
 * Gives back bytes that had already been settled into `storage_used_bytes`, which is what a purged
 * asset's object leaves behind. Call only when the asset's own `deleting -> deleted` transition
 * returned a row, in the same transaction; that transition is the once-only guard.
 */
export async function releaseStoredBytes(
  tx: HandoffTransaction,
  input: { workspaceId: string; actualBytes: number },
): Promise<WorkspaceStorageRow | null> {
  const [row] = await tx
    .update(workspaces)
    .set({
      storageUsedBytes: sql`greatest(${workspaces.storageUsedBytes} - ${input.actualBytes}, 0)`,
    })
    .where(eq(workspaces.id, input.workspaceId))
    .returning(storageColumns);
  return row ?? null;
}

export async function findWorkspaceStorage(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<WorkspaceStorageRow | null> {
  const [row] = await tx
    .select(storageColumns)
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row ?? null;
}
