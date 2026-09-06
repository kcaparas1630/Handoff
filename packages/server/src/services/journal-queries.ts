// Three bounded reads the milestone 2 repositories do not expose yet. They are repository work
// and belong in packages/db/src/repositories/events.ts; that package is outside the scope of this
// change, so they live here and should move on the next database change. Everything else in the
// server calls a repository.
import { and, asc, eq, gte, lte, or } from "drizzle-orm";
import { schema } from "@handoff/db";
import type { EventRevisionRow, EventRow, HandoffTransaction } from "@handoff/db";

/**
 * The events a confirmed capture already produced. Confirmation replay returns these instead of
 * creating a second set; UNIQUE (capture_id, source_candidate_id) is what makes that safe.
 */
export function listEventsForCapture(
  tx: HandoffTransaction,
  workspaceId: string,
  captureId: string,
): Promise<EventRow[]> {
  return tx
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.workspaceId, workspaceId), eq(schema.events.captureId, captureId)));
}

/**
 * Resolves the child that owns an event for the `/v1/events/:eventId` routes, which carry no
 * workspace or child in the path. Runs inside a tenant transaction, so a caller only ever sees
 * their own workspace's events; child permission is still checked afterwards.
 */
export async function findEventLocation(
  tx: HandoffTransaction,
  workspaceId: string,
  eventId: string,
): Promise<{ workspaceId: string; childId: string } | null> {
  const [row] = await tx
    .select({ workspaceId: schema.events.workspaceId, childId: schema.events.childId })
    .from(schema.events)
    .where(and(eq(schema.events.workspaceId, workspaceId), eq(schema.events.id, eventId)))
    .limit(1);
  return row ?? null;
}

/**
 * The disclosed first-handoff window: published in the last 24 hours, or describing care that
 * happened in the last 24 hours. Filtered in SQL so a first brief never decrypts the whole
 * journal to throw most of it away.
 */
export function listInitialWindowRevisions(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; throughSeqInclusive: number; since: Date },
): Promise<{ revision: EventRevisionRow }[]> {
  return tx
    .select({ revision: schema.eventRevisions })
    .from(schema.eventRevisions)
    .innerJoin(
      schema.events,
      and(
        eq(schema.events.workspaceId, schema.eventRevisions.workspaceId),
        eq(schema.events.childId, schema.eventRevisions.childId),
        eq(schema.events.id, schema.eventRevisions.eventId),
      ),
    )
    .where(
      and(
        eq(schema.eventRevisions.workspaceId, input.workspaceId),
        eq(schema.eventRevisions.childId, input.childId),
        lte(schema.eventRevisions.journalSeq, input.throughSeqInclusive),
        or(
          gte(schema.eventRevisions.createdAt, input.since),
          gte(schema.events.occurredAt, input.since),
        ),
      ),
    )
    .orderBy(asc(schema.eventRevisions.journalSeq));
}
