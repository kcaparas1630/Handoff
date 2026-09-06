import { sql } from "drizzle-orm";
import type { HandoffDatabase, HandoffTransaction } from "./types/database";

export type IsolationLevel = "read committed" | "repeatable read" | "serializable";

export interface TenantContext {
  workspaceId: string;
  /** Brief generation asks for `repeatable read` so its cutoff and its sources agree (§4). */
  isolationLevel?: IsolationLevel;
}

/** What the caller has already proven about themselves before any workspace is known. */
export interface IdentityContext {
  /** Local UUID of the authenticated Clerk subject. */
  userId?: string;
  /** Organization the caller has been verified an admin of, for find-or-create by org id. */
  clerkOrgId?: string;
}

/**
 * Runs `run` with the row-level security workspace context set for this transaction only.
 * Connection-global settings would leak the tenant to the next request on a pooled connection.
 */
export async function withTenantTransaction<T>(
  db: HandoffDatabase,
  { workspaceId, isolationLevel }: TenantContext,
  run: (tx: HandoffTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`select set_config('handoff.workspace_id', ${workspaceId}, true)`);
      return run(tx);
    },
    isolationLevel === undefined ? undefined : { isolationLevel },
  );
}

/**
 * Sets the identity lookup context mid-transaction. Bootstrap needs this because it upserts the
 * user row before it knows the local user id; `users` carries no policy, so the insert works
 * first and the setting is applied before any membership or workspace read.
 */
export async function setIdentityContext(
  tx: HandoffTransaction,
  context: IdentityContext,
): Promise<void> {
  if (context.userId !== undefined) {
    await tx.execute(sql`select set_config('handoff.user_id', ${context.userId}, true)`);
  }
  if (context.clerkOrgId !== undefined) {
    await tx.execute(sql`select set_config('handoff.clerk_org_id', ${context.clerkOrgId}, true)`);
  }
}

/**
 * For the narrow non-tenant paths: bootstrap by verified Clerk subject and workspace
 * initialization by verified organization id. Passing no context reaches only `users`.
 */
export async function withIdentityTransaction<T>(
  db: HandoffDatabase,
  context: IdentityContext,
  run: (tx: HandoffTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setIdentityContext(tx, context);
    return run(tx);
  });
}
