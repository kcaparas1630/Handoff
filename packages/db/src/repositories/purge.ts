import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  captures,
  careSessions,
  childCaregivers,
  children,
  eventRevisions,
  events,
  handoffBriefs,
  handoffCursors,
  idempotencyRequests,
  invitationChildGrants,
  invitationIntents,
  jobs,
  mediaAssets,
  workspaceMemberships,
} from "../schema";
import type { HandoffTransaction } from "../types/database";
import type { JobKind } from "../types/enums";
import type { ChildScope, PurgeCounts } from "../types/purge";

// Row removal for the purge capability. Every statement here runs on the dispatcher credential in
// a tenant transaction (migrations/README.md): the API role holds no DELETE on any table, so a
// mobile request can mark a child inaccessible and enqueue the work but can never remove a row.
//
// Deletion order matters and is owned by the job handlers, not by these functions:
// jobs -> revisions -> events -> media assets -> captures -> care sessions -> cursors -> grants.
// `events_current_revision_fk` is deferred, so revisions and events must be removed inside one
// transaction; every other reference is checked immediately.

/**
 * Queue rows for one child. They name captures and assets that are about to stop existing.
 * `exceptJobId` is the purge job doing the work: it must outlive the rows it removes.
 */
export async function deleteJobsForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
  exceptJobId?: string,
): Promise<number> {
  const rows = await tx
    .delete(jobs)
    .where(
      and(
        eq(jobs.workspaceId, ids.workspaceId),
        eq(jobs.childId, ids.childId),
        exceptJobId === undefined ? undefined : ne(jobs.id, exceptJobId),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

export async function deleteJobsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
  exceptJobId?: string,
): Promise<number> {
  const rows = await tx
    .delete(jobs)
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        exceptJobId === undefined ? undefined : ne(jobs.id, exceptJobId),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/**
 * Cancels queued and leased work without removing the rows, so a mid-flight worker loses. The
 * purge kinds are excluded: they are the work that carries out the deletion, and cancelling them
 * would leave the records marked inaccessible but never removed.
 */
const CANCELLABLE_KINDS: readonly JobKind[] = [
  "process_capture",
  "validate_media",
  "cleanup_audio",
  "cleanup_uploads",
  "reconcile_clerk",
  "rotate_data_keys",
];

export async function cancelJobsForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<string[]> {
  const rows = await tx
    .update(jobs)
    .set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(jobs.workspaceId, ids.workspaceId),
        eq(jobs.childId, ids.childId),
        inArray(jobs.status, ["queued", "leased"]),
        inArray(jobs.kind, [...CANCELLABLE_KINDS]),
      ),
    )
    .returning({ id: jobs.id });
  return rows.map((row) => row.id);
}

export async function cancelJobsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<string[]> {
  const rows = await tx
    .update(jobs)
    .set({ status: "cancelled", leaseToken: null, leaseExpiresAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(jobs.workspaceId, workspaceId),
        inArray(jobs.status, ["queued", "leased"]),
        inArray(jobs.kind, [...CANCELLABLE_KINDS]),
      ),
    )
    .returning({ id: jobs.id });
  return rows.map((row) => row.id);
}

/** Revisions first: the event's current-revision key is deferred, this one is not. */
export async function deleteJournalForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<{ revisions: number; events: number }> {
  const removedRevisions = await tx
    .delete(eventRevisions)
    .where(
      and(eq(eventRevisions.workspaceId, ids.workspaceId), eq(eventRevisions.childId, ids.childId)),
    )
    .returning({ id: eventRevisions.id });
  const removedEvents = await tx
    .delete(events)
    .where(and(eq(events.workspaceId, ids.workspaceId), eq(events.childId, ids.childId)))
    .returning({ id: events.id });
  return { revisions: removedRevisions.length, events: removedEvents.length };
}

export async function deleteMediaAssetsForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<number> {
  const rows = await tx
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, ids.workspaceId), eq(mediaAssets.childId, ids.childId)))
    .returning({ id: mediaAssets.id });
  return rows.length;
}

export async function deleteCapturesForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<number> {
  const rows = await tx
    .delete(captures)
    .where(and(eq(captures.workspaceId, ids.workspaceId), eq(captures.childId, ids.childId)))
    .returning({ id: captures.id });
  return rows.length;
}

export async function deleteCareSessionsForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<number> {
  const rows = await tx
    .delete(careSessions)
    .where(
      and(eq(careSessions.workspaceId, ids.workspaceId), eq(careSessions.childId, ids.childId)),
    )
    .returning({ id: careSessions.id });
  return rows.length;
}

export async function deleteCursorsForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<number> {
  const rows = await tx
    .delete(handoffCursors)
    .where(
      and(eq(handoffCursors.workspaceId, ids.workspaceId), eq(handoffCursors.childId, ids.childId)),
    )
    .returning({ userId: handoffCursors.userId });
  return rows.length;
}

/** Both kinds of child access: the granted caregivers and the grants an invitation proposed. */
export async function deleteChildAccessForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<number> {
  const granted = await tx
    .delete(childCaregivers)
    .where(
      and(
        eq(childCaregivers.workspaceId, ids.workspaceId),
        eq(childCaregivers.childId, ids.childId),
      ),
    )
    .returning({ userId: childCaregivers.userId });
  const invited = await tx
    .delete(invitationChildGrants)
    .where(
      and(
        eq(invitationChildGrants.workspaceId, ids.workspaceId),
        eq(invitationChildGrants.childId, ids.childId),
      ),
    )
    .returning({ childId: invitationChildGrants.childId });
  return granted.length + invited.length;
}

/**
 * Workspace purge only. A child purge keeps its briefs as redacted rows, which is what the child
 * tombstone exists for; once the whole workspace is gone there is nothing left to consult.
 */
export async function deleteBriefsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<number> {
  const rows = await tx
    .delete(handoffBriefs)
    .where(eq(handoffBriefs.workspaceId, workspaceId))
    .returning({ id: handoffBriefs.id });
  return rows.length;
}

export async function deleteInvitationsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<number> {
  await tx.delete(invitationChildGrants).where(eq(invitationChildGrants.workspaceId, workspaceId));
  const rows = await tx
    .delete(invitationIntents)
    .where(eq(invitationIntents.workspaceId, workspaceId))
    .returning({ id: invitationIntents.id });
  return rows.length;
}

/**
 * Retained idempotency responses are encrypted copies of DTOs, so a deleted workspace's rows go
 * with it rather than waiting out their retry window. The table carries no tenant policy, so the
 * scope column is the filter.
 */
export async function deleteIdempotencyRequestsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<number> {
  const rows = await tx
    .delete(idempotencyRequests)
    .where(eq(idempotencyRequests.scopeWorkspaceId, workspaceId))
    .returning({ key: idempotencyRequests.key });
  return rows.length;
}

export async function deleteMembershipsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<number> {
  const rows = await tx
    .delete(workspaceMemberships)
    .where(eq(workspaceMemberships.workspaceId, workspaceId))
    .returning({ userId: workspaceMemberships.userId });
  return rows.length;
}

const countColumn = { count: sql<number>`count(*)::int` };

async function count(run: () => Promise<{ count: number }[]>): Promise<number> {
  const [row] = await run();
  return row?.count ?? 0;
}

/**
 * What a purge left behind. Every number must be zero for a completed child purge except
 * `redactedBriefs`, which is the retained audit trail, and the child tombstone those briefs and
 * the audit log point at. `scripts/verify-purge.ts` is the operator-facing reading of this.
 */
export async function countRemainingForChild(
  tx: HandoffTransaction,
  ids: ChildScope,
): Promise<PurgeCounts> {
  const { workspaceId, childId } = ids;
  return {
    captures: await count(() =>
      tx
        .select(countColumn)
        .from(captures)
        .where(and(eq(captures.workspaceId, workspaceId), eq(captures.childId, childId))),
    ),
    events: await count(() =>
      tx
        .select(countColumn)
        .from(events)
        .where(and(eq(events.workspaceId, workspaceId), eq(events.childId, childId))),
    ),
    eventRevisions: await count(() =>
      tx
        .select(countColumn)
        .from(eventRevisions)
        .where(
          and(eq(eventRevisions.workspaceId, workspaceId), eq(eventRevisions.childId, childId)),
        ),
    ),
    mediaAssets: await count(() =>
      tx
        .select(countColumn)
        .from(mediaAssets)
        .where(and(eq(mediaAssets.workspaceId, workspaceId), eq(mediaAssets.childId, childId))),
    ),
    careSessions: await count(() =>
      tx
        .select(countColumn)
        .from(careSessions)
        .where(and(eq(careSessions.workspaceId, workspaceId), eq(careSessions.childId, childId))),
    ),
    handoffCursors: await count(() =>
      tx
        .select(countColumn)
        .from(handoffCursors)
        .where(
          and(eq(handoffCursors.workspaceId, workspaceId), eq(handoffCursors.childId, childId)),
        ),
    ),
    childCaregivers: await count(() =>
      tx
        .select(countColumn)
        .from(childCaregivers)
        .where(
          and(eq(childCaregivers.workspaceId, workspaceId), eq(childCaregivers.childId, childId)),
        ),
    ),
    invitationChildGrants: await count(() =>
      tx
        .select(countColumn)
        .from(invitationChildGrants)
        .where(
          and(
            eq(invitationChildGrants.workspaceId, workspaceId),
            eq(invitationChildGrants.childId, childId),
          ),
        ),
    ),
    jobs: await count(() =>
      tx
        .select(countColumn)
        .from(jobs)
        .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.childId, childId))),
    ),
    unredactedBriefs: await count(() =>
      tx
        .select(countColumn)
        .from(handoffBriefs)
        .where(
          and(
            eq(handoffBriefs.workspaceId, workspaceId),
            eq(handoffBriefs.childId, childId),
            ne(handoffBriefs.status, "redacted"),
          ),
        ),
    ),
    redactedBriefs: await count(() =>
      tx
        .select(countColumn)
        .from(handoffBriefs)
        .where(
          and(
            eq(handoffBriefs.workspaceId, workspaceId),
            eq(handoffBriefs.childId, childId),
            eq(handoffBriefs.status, "redacted"),
          ),
        ),
    ),
    liveChildRows: await count(() =>
      tx
        .select(countColumn)
        .from(children)
        .where(
          and(
            eq(children.workspaceId, workspaceId),
            eq(children.id, childId),
            ne(children.status, "deleted"),
          ),
        ),
    ),
  };
}

/** Children whose purge has not reached its terminal state yet, for a resumed workspace purge. */
export async function listChildIdsToPurge(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: children.id })
    .from(children)
    .where(and(eq(children.workspaceId, workspaceId), ne(children.status, "deleted")))
    .orderBy(children.createdAt, children.id);
  return rows.map((row) => row.id);
}
