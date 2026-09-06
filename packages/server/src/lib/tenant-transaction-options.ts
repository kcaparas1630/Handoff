// Brief generation needs a repeatable-read transaction so the cutoff, the source revisions, and
// the saved snapshot all agree (data contract §4). `withTenantTransaction` in @handoff/db takes
// no isolation option, so these three lines are duplicated here on purpose rather than widening
// that helper's signature for one caller.
import { sql } from "drizzle-orm";
import type { HandoffDatabase, HandoffTransaction } from "@handoff/db";

type IsolationLevel = "read committed" | "repeatable read" | "serializable";

export function withTenantTransactionOptions<T>(
  db: HandoffDatabase,
  { workspaceId, isolationLevel }: { workspaceId: string; isolationLevel: IsolationLevel },
  run: (tx: HandoffTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`select set_config('handoff.workspace_id', ${workspaceId}, true)`);
      return run(tx);
    },
    { isolationLevel },
  );
}
