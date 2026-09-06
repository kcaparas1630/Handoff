import { and, eq, sql } from "drizzle-orm";
import { children, handoffCursors } from "../schema";
import { listActiveSessionsForChild } from "./care";
import { countPendingCapturesForChild } from "./captures";
import type { OverviewMetadata } from "../types/care";
import type { HandoffTransaction } from "../types/database";

/**
 * The counters the dashboard needs before it decides what to render. Three reads rather than one
 * join: the sessions list is a set, and joining it to scalar counters would multiply rows.
 * A missing cursor means this recipient has acknowledged nothing yet, which is sequence zero.
 */
export async function readOverviewMetadata(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; userId: string },
): Promise<OverviewMetadata | null> {
  const [counters] = await tx
    .select({
      journalSeq: children.journalSeq,
      acknowledgedSeq: sql<number>`coalesce(${handoffCursors.acknowledgedSeq}, 0)`,
    })
    .from(children)
    .leftJoin(
      handoffCursors,
      and(
        eq(handoffCursors.workspaceId, children.workspaceId),
        eq(handoffCursors.childId, children.id),
        eq(handoffCursors.userId, input.userId),
      ),
    )
    .where(and(eq(children.workspaceId, input.workspaceId), eq(children.id, input.childId)))
    .limit(1);
  if (!counters) return null;

  return {
    journalSeq: counters.journalSeq,
    acknowledgedSeq: Number(counters.acknowledgedSeq),
    pendingCaptureCount: await countPendingCapturesForChild(tx, input.workspaceId, input.childId),
    activeSessions: await listActiveSessionsForChild(tx, input.workspaceId, input.childId),
  };
}
