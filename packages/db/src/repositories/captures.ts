import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { captures } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type {
  CaptureDraftUpdate,
  CaptureRow,
  CaptureStatusUpdate,
  NewCapture,
} from "../types/journal";
import type { CaptureStatus } from "../types/enums";

/** Statuses that mean the server still owes this capture a decision. */
const pendingStatuses: CaptureStatus[] = [
  "awaiting_upload",
  "queued",
  "processing",
  "needs_review",
];

/**
 * A resubmitted client capture id returns the row that already exists rather than a duplicate.
 * The conflict target is the author's own key, so two authors may reuse the same client id.
 */
export async function insertCapture(
  tx: HandoffTransaction,
  input: NewCapture,
): Promise<CaptureRow> {
  const [inserted] = await tx
    .insert(captures)
    .values(input)
    .onConflictDoNothing({
      target: [captures.workspaceId, captures.authorUserId, captures.clientCaptureId],
    })
    .returning();
  if (inserted) return inserted;

  const [existing] = await tx
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.workspaceId, input.workspaceId),
        eq(captures.authorUserId, input.authorUserId),
        eq(captures.clientCaptureId, input.clientCaptureId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("capture insert conflicted but no matching capture is present");
  return existing;
}

export async function findCaptureInWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
  captureId: string,
): Promise<CaptureRow | null> {
  const [row] = await tx
    .select()
    .from(captures)
    .where(and(eq(captures.workspaceId, workspaceId), eq(captures.id, captureId)))
    .limit(1);
  return row ?? null;
}

export async function listCapturesForChild(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; statuses?: CaptureStatus[]; limit: number },
): Promise<CaptureRow[]> {
  return tx
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.workspaceId, input.workspaceId),
        eq(captures.childId, input.childId),
        input.statuses ? inArray(captures.status, input.statuses) : undefined,
      ),
    )
    .orderBy(desc(captures.createdAt), desc(captures.id))
    .limit(input.limit);
}

/**
 * Recordings the caregiver never finished reviewing. Retention marks these for cleanup after a
 * fixed interval (architecture section 6); the sweep runs per workspace under tenant isolation.
 */
export async function listUnconfirmedCapturesBefore(
  tx: HandoffTransaction,
  input: { workspaceId: string; before: Date; limit: number },
): Promise<CaptureRow[]> {
  return tx
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.workspaceId, input.workspaceId),
        inArray(captures.status, pendingStatuses),
        lt(captures.createdAt, input.before),
      ),
    )
    .orderBy(asc(captures.createdAt), asc(captures.id))
    .limit(input.limit);
}

/** The "server knows about N unfinished recordings" count a brief and the overview disclose. */
export async function countPendingCapturesForChild(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(captures)
    .where(
      and(
        eq(captures.workspaceId, workspaceId),
        eq(captures.childId, childId),
        inArray(captures.status, pendingStatuses),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Returns null when the draft moved on, so a slow client or a retried worker cannot overwrite a
 * newer draft. Both counters advance: the draft payload version and the row's edit version.
 */
export async function updateCaptureDraft(
  tx: HandoffTransaction,
  input: CaptureDraftUpdate,
): Promise<CaptureRow | null> {
  const [row] = await tx
    .update(captures)
    .set({
      contentCiphertext: input.contentCiphertext,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.promptVersion === undefined ? {} : { promptVersion: input.promptVersion }),
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      draftVersion: sql`${captures.draftVersion} + 1`,
      updatedAt: sql`now()`,
      version: sql`${captures.version} + 1`,
    })
    .where(
      and(
        eq(captures.workspaceId, input.workspaceId),
        eq(captures.id, input.captureId),
        eq(captures.draftVersion, input.expectedDraftVersion),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Marks the capture confirmed exactly once. The status predicate is what makes a replayed
 * confirmation a no-op: an already confirmed capture matches nothing and returns null.
 */
export async function markCaptureConfirmed(
  tx: HandoffTransaction,
  input: { workspaceId: string; captureId: string; expectedVersion: number },
): Promise<CaptureRow | null> {
  const [row] = await tx
    .update(captures)
    .set({
      status: "confirmed",
      confirmedAt: sql`now()`,
      updatedAt: sql`now()`,
      version: sql`${captures.version} + 1`,
    })
    .where(
      and(
        eq(captures.workspaceId, input.workspaceId),
        eq(captures.id, input.captureId),
        eq(captures.version, input.expectedVersion),
        eq(captures.status, "needs_review"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function updateCaptureStatus(
  tx: HandoffTransaction,
  input: CaptureStatusUpdate,
): Promise<CaptureRow | null> {
  const [row] = await tx
    .update(captures)
    .set({
      status: input.status,
      errorCode: input.errorCode ?? null,
      updatedAt: sql`now()`,
      version: sql`${captures.version} + 1`,
    })
    .where(and(eq(captures.workspaceId, input.workspaceId), eq(captures.id, input.captureId)))
    .returning();
  return row ?? null;
}
