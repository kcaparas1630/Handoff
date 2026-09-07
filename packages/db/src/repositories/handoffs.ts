import { and, desc, eq, sql } from "drizzle-orm";
import { handoffBriefs, handoffCursors } from "../schema";
import type {
  AdvanceCursor,
  HandoffBriefRow,
  HandoffCursorRow,
  NewHandoffBrief,
} from "../types/care";
import type { HandoffTransaction } from "../types/database";

export async function findCursor(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
  userId: string,
): Promise<HandoffCursorRow | null> {
  const [row] = await tx
    .select()
    .from(handoffCursors)
    .where(
      and(
        eq(handoffCursors.workspaceId, workspaceId),
        eq(handoffCursors.childId, childId),
        eq(handoffCursors.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Materializes the recipient's cursor at zero if it is missing, then locks it. Acknowledgement
 * takes the child lock before this one; keeping that order is what avoids deadlocks.
 */
export async function lockCursorForUpdate(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
  userId: string,
): Promise<HandoffCursorRow> {
  await tx
    .insert(handoffCursors)
    .values({ workspaceId, childId, userId })
    .onConflictDoNothing({
      target: [handoffCursors.workspaceId, handoffCursors.childId, handoffCursors.userId],
    });

  const [row] = await tx
    .select()
    .from(handoffCursors)
    .where(
      and(
        eq(handoffCursors.workspaceId, workspaceId),
        eq(handoffCursors.childId, childId),
        eq(handoffCursors.userId, userId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new Error("lockCursorForUpdate found no cursor after ensuring it exists");
  return row;
}

/**
 * Monotonic by construction: acknowledging an older brief while a newer one is already consumed
 * records the brief but leaves the counter where it is.
 */
export async function advanceCursor(
  tx: HandoffTransaction,
  input: AdvanceCursor,
): Promise<HandoffCursorRow> {
  const [row] = await tx
    .update(handoffCursors)
    .set({
      acknowledgedSeq: sql`greatest(${handoffCursors.acknowledgedSeq}, ${input.acknowledgedSeq})`,
      // An older brief acknowledged out of order must not replace the newer brief reference.
      lastAcknowledgedBriefId: sql`case when ${input.acknowledgedSeq} >= ${handoffCursors.acknowledgedSeq} then ${input.briefId}::uuid else ${handoffCursors.lastAcknowledgedBriefId} end`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(handoffCursors.workspaceId, input.workspaceId),
        eq(handoffCursors.childId, input.childId),
        eq(handoffCursors.userId, input.userId),
      ),
    )
    .returning();
  if (!row) throw new Error("advanceCursor found no cursor to advance");
  return row;
}

export async function insertBrief(
  tx: HandoffTransaction,
  input: NewHandoffBrief,
): Promise<HandoffBriefRow> {
  const [row] = await tx.insert(handoffBriefs).values(input).returning();
  if (!row) throw new Error("insertBrief returned no row");
  return row;
}

/** A brief belongs to one recipient; another user's id simply finds nothing. */
export async function findBriefForRecipient(
  tx: HandoffTransaction,
  workspaceId: string,
  briefId: string,
  recipientUserId: string,
): Promise<HandoffBriefRow | null> {
  const [row] = await tx
    .select()
    .from(handoffBriefs)
    .where(
      and(
        eq(handoffBriefs.workspaceId, workspaceId),
        eq(handoffBriefs.id, briefId),
        eq(handoffBriefs.recipientUserId, recipientUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Returns null on replay: the first acknowledgement is the one that stamps the row. */
export async function markBriefAcknowledged(
  tx: HandoffTransaction,
  input: {
    workspaceId: string;
    briefId: string;
    recipientUserId: string;
    startedSessionId?: string | null;
  },
): Promise<HandoffBriefRow | null> {
  const [row] = await tx
    .update(handoffBriefs)
    .set({
      acknowledgedAt: sql`now()`,
      startedSessionId: input.startedSessionId ?? null,
    })
    .where(
      and(
        eq(handoffBriefs.workspaceId, input.workspaceId),
        eq(handoffBriefs.id, input.briefId),
        eq(handoffBriefs.recipientUserId, input.recipientUserId),
        sql`${handoffBriefs.acknowledgedAt} is null`,
      ),
    )
    .returning();
  return row ?? null;
}

export async function listBriefsForRecipient(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; recipientUserId: string; limit: number },
): Promise<HandoffBriefRow[]> {
  return tx
    .select()
    .from(handoffBriefs)
    .where(
      and(
        eq(handoffBriefs.workspaceId, input.workspaceId),
        eq(handoffBriefs.childId, input.childId),
        eq(handoffBriefs.recipientUserId, input.recipientUserId),
      ),
    )
    .orderBy(desc(handoffBriefs.createdAt), desc(handoffBriefs.id))
    .limit(input.limit);
}

/** Every brief written for one child, whatever its recipient, for redaction during a purge. */
export async function listBriefsForChild(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; limit: number },
): Promise<HandoffBriefRow[]> {
  return tx
    .select()
    .from(handoffBriefs)
    .where(
      and(
        eq(handoffBriefs.workspaceId, input.workspaceId),
        eq(handoffBriefs.childId, input.childId),
      ),
    )
    .orderBy(handoffBriefs.createdAt, handoffBriefs.id)
    .limit(input.limit);
}

/**
 * Replaces a brief's copied snapshot with an encrypted empty one and marks it redacted. The row
 * stays because it is the record that this recipient acknowledged a handoff; its care content
 * does not. The started session is released here too, since the purge removes that session.
 */
export async function redactBrief(
  tx: HandoffTransaction,
  input: { workspaceId: string; briefId: string; snapshotCiphertext: unknown },
): Promise<HandoffBriefRow | null> {
  const [row] = await tx
    .update(handoffBriefs)
    .set({
      status: "redacted",
      snapshotCiphertext: input.snapshotCiphertext,
      startedSessionId: null,
    })
    .where(
      and(eq(handoffBriefs.workspaceId, input.workspaceId), eq(handoffBriefs.id, input.briefId)),
    )
    .returning();
  return row ?? null;
}
