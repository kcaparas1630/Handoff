// Lets a database-only service either open its own tenant transaction or join one the caller has
// already opened, so the write and the idempotency record that replays it commit together
// (data contract §5: "Insert idempotency results in the same transaction as business writes when
// both are database-only"). Services that call Clerk between local writes must not use this.
import { withTenantTransaction } from "@handoff/db";
import type { HandoffTransaction } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import type { ServiceDeps } from "../types/runtime";

/** A transaction whose row-level-security context is already set to `workspaceId`. */
export interface ScopedTransaction {
  transaction: HandoffTransaction;
  workspaceId: string;
}

export function inTenantTransaction<T>(
  deps: ServiceDeps,
  workspaceId: string,
  scoped: ScopedTransaction | undefined,
  run: (tx: HandoffTransaction) => Promise<T>,
): Promise<T> {
  if (scoped === undefined) return withTenantTransaction(deps.db, { workspaceId }, run);
  if (scoped.workspaceId !== workspaceId) {
    // A caller handing over a transaction scoped to another tenant is a programming error, and
    // row-level security would silently return nothing rather than fail. Fail closed instead.
    throw new ApiHttpError({
      status: 500,
      code: "internal",
      message: "The supplied transaction belongs to another workspace",
    });
  }
  return run(scoped.transaction);
}
