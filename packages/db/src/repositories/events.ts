import { and, asc, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { children, eventRevisions, events } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type { EventKind } from "../types/enums";
import type {
  AppendRevisionInput,
  EventPatch,
  EventRevisionRow,
  EventRow,
  ListEventsQuery,
  NewEvent,
  NewEventRevision,
} from "../types/journal";

// The only module that writes events and revisions. Every published change goes: lock the child,
// allocate a sequence, write the projection and its immutable revision, commit.

/**
 * Serializes published changes for one child. Held until the transaction commits, so the
 * allocated sequence and the revision carrying it become visible together.
 */
export async function lockChildForJournalWrite(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<{ journalSeq: number } | null> {
  const [row] = await tx
    .select({ journalSeq: children.journalSeq })
    .from(children)
    .where(and(eq(children.workspaceId, workspaceId), eq(children.id, childId)))
    .limit(1)
    .for("update");
  return row ?? null;
}

/**
 * Allocates the next sequence for a child. Call only after lockChildForJournalWrite in the same
 * transaction. A rolled back transaction leaves a gap; the counter is an ordering, not a count.
 * The child's own updated_at and version stay put: a journal write is not a profile edit.
 */
export async function allocateJournalSeq(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<number> {
  const [row] = await tx
    .update(children)
    .set({ journalSeq: sql`${children.journalSeq} + 1` })
    .where(and(eq(children.workspaceId, workspaceId), eq(children.id, childId)))
    .returning({ journalSeq: children.journalSeq });
  if (!row) throw new Error("allocateJournalSeq found no child to advance");
  return row.journalSeq;
}

/**
 * Writes an event and its `created` revision. They reference each other, which the deferred
 * current-revision key permits: both rows are checked at commit, so either insert order works.
 */
export async function insertEventWithRevision(
  tx: HandoffTransaction,
  input: { event: NewEvent; revision: NewEventRevision },
): Promise<{ event: EventRow; revision: EventRevisionRow }> {
  const [event] = await tx.insert(events).values(input.event).returning();
  if (!event) throw new Error("insertEventWithRevision returned no event");

  const [revision] = await tx.insert(eventRevisions).values(input.revision).returning();
  if (!revision) throw new Error("insertEventWithRevision returned no revision");

  return { event, revision };
}

/**
 * Corrects, deletes, or re-attaches media on an existing event. Returns null when the expected
 * version no longer matches, and writes nothing in that case, so the caller reports a conflict.
 * The projection update points at the new revision before that revision exists; the deferred key
 * settles at commit.
 */
export async function appendEventRevision(
  tx: HandoffTransaction,
  input: {
    workspaceId: string;
    childId: string;
    eventId: string;
    expectedVersion: number;
    patch: EventPatch;
    revision: AppendRevisionInput;
  },
): Promise<EventRow | null> {
  const [event] = await tx
    .update(events)
    .set({
      occurredAt: input.patch.occurredAt,
      endedAt: input.patch.endedAt,
      timezone: input.patch.timezone,
      timePrecision: input.patch.timePrecision,
      payloadCiphertext: input.patch.payloadCiphertext,
      important: input.patch.important,
      status: input.patch.status,
      currentRevisionId: input.revision.id,
      lastEditedByUserId: input.revision.actorUserId,
      updatedAt: sql`now()`,
      version: sql`${events.version} + 1`,
    })
    .where(
      and(
        eq(events.workspaceId, input.workspaceId),
        eq(events.childId, input.childId),
        eq(events.id, input.eventId),
        eq(events.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!event) return null;

  await tx.insert(eventRevisions).values({
    id: input.revision.id,
    workspaceId: input.workspaceId,
    childId: input.childId,
    eventId: input.eventId,
    journalSeq: input.revision.journalSeq,
    eventVersion: event.version,
    operation: input.revision.operation,
    actorUserId: input.revision.actorUserId,
    contentCiphertext: input.revision.contentCiphertext,
    sourceStart: input.revision.sourceStart ?? null,
    sourceEnd: input.revision.sourceEnd ?? null,
  });

  return event;
}

export async function findEventInChild(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
  eventId: string,
): Promise<EventRow | null> {
  const [row] = await tx
    .select()
    .from(events)
    .where(
      and(eq(events.workspaceId, workspaceId), eq(events.childId, childId), eq(events.id, eventId)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * One page of the timeline in `occurred_at DESC NULLS LAST, id DESC` order. Unknown-time events
 * sort last but stay on the same stable page sequence; the server encodes the returned position
 * into an opaque cursor.
 */
export async function listEventsForChild(
  tx: HandoffTransaction,
  query: ListEventsQuery,
): Promise<EventRow[]> {
  return tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspaceId, query.workspaceId),
        eq(events.childId, query.childId),
        eq(events.status, query.status ?? "active"),
        query.kind ? eq(events.kind, query.kind) : undefined,
        keysetBefore(query.cursor),
      ),
    )
    .orderBy(sql`${events.occurredAt} desc nulls last`, desc(events.id))
    .limit(query.limit);
}

/** Rows strictly after the cursor in the timeline order; nulls trail every timed event. */
function keysetBefore(cursor: ListEventsQuery["cursor"]) {
  if (!cursor) return undefined;
  if (cursor.occurredAt === null) {
    return and(isNull(events.occurredAt), lt(events.id, cursor.id));
  }
  return or(
    lt(events.occurredAt, cursor.occurredAt),
    and(eq(events.occurredAt, cursor.occurredAt), lt(events.id, cursor.id)),
    isNull(events.occurredAt),
  );
}

/** The published changes a brief covers: everything after the cursor through the brief's cutoff. */
export async function listRevisionsInWindow(
  tx: HandoffTransaction,
  childId: string,
  fromSeqExclusive: number,
  throughSeqInclusive: number,
): Promise<EventRevisionRow[]> {
  return tx
    .select()
    .from(eventRevisions)
    .where(
      and(
        eq(eventRevisions.childId, childId),
        sql`${eventRevisions.journalSeq} > ${fromSeqExclusive}`,
        sql`${eventRevisions.journalSeq} <= ${throughSeqInclusive}`,
      ),
    )
    .orderBy(asc(eventRevisions.journalSeq));
}

export async function listRevisionsForEvent(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
  eventId: string,
): Promise<EventRevisionRow[]> {
  return tx
    .select()
    .from(eventRevisions)
    .where(
      and(
        eq(eventRevisions.workspaceId, workspaceId),
        eq(eventRevisions.childId, childId),
        eq(eventRevisions.eventId, eventId),
      ),
    )
    .orderBy(asc(eventRevisions.eventVersion));
}

/**
 * Latest-known care context for one kind, by when it happened rather than when it was logged.
 * Unknown-time events are excluded: "latest known feed" cannot cite an event with no time.
 */
export async function findLatestConfirmedFactByKind(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; kind: EventKind },
): Promise<EventRow | null> {
  const [row] = await tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspaceId, input.workspaceId),
        eq(events.childId, input.childId),
        eq(events.kind, input.kind),
        eq(events.status, "active"),
        sql`${events.occurredAt} is not null`,
      ),
    )
    .orderBy(desc(events.occurredAt), desc(events.id))
    .limit(1);
  return row ?? null;
}

/** Confirmed events whose occurrence time stayed unknown. Shown by log time, labelled as such. */
export async function listRecentUnknownTimeEvents(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; since: Date },
): Promise<EventRow[]> {
  return tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.workspaceId, input.workspaceId),
        eq(events.childId, input.childId),
        eq(events.status, "active"),
        isNull(events.occurredAt),
        gte(events.createdAt, input.since),
      ),
    )
    .orderBy(desc(events.createdAt), desc(events.id));
}
