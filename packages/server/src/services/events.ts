// Reading the confirmed timeline, and the two published changes that are not a creation:
// correction and deletion. Both append an immutable revision under the child lock; nothing here
// patches the `events` projection on its own (data contract §3).
import { randomUUID } from "node:crypto";
import { eventsRepository, infrastructureRepository, withTenantTransaction } from "@handoff/db";
import { canCorrectEvent, validateEventSemantics } from "@handoff/domain";
import type {
  CursorPage,
  DeleteEventRequest,
  EventDto,
  EventsListQuery,
  RevisionSnapshot,
  UpdateEventRequest,
} from "@handoff/contracts";
import type { EventRow, HandoffTransaction, RevisionOperation } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { decodeEventCursor, encodeEventCursor } from "../lib/event-cursor";
import {
  applyEventPatch,
  eventFactsFromRow,
  eventPayloadOf,
  revisionSnapshotOf,
  semanticsInputOf,
  toEventDto,
} from "../lib/event-dto";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import {
  decryptEventPayload,
  decryptRevisionSnapshot,
  encryptEventPayload,
  encryptRevisionSnapshot,
} from "../security/journal-fields";
import { withRequestKeyCache } from "../security/request-key-cache";
import { resolveChildWorkspace, resolveEventLocation } from "./workspace-lookup";
import type { EventFacts } from "../types/journal";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

export async function listEvents({
  deps,
  actorUserId,
  childId,
  query,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
  query: EventsListQuery;
}): Promise<CursorPage<EventDto>> {
  const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
  const cursor = query.cursor === undefined ? null : decodeEventCursor(query.cursor);
  if (query.cursor !== undefined && cursor === null) {
    throw ApiHttpError.validationFailed("That page cursor is not valid", {
      cursor: ["Expected a cursor this server issued"],
    });
  }

  const rows = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
    return eventsRepository.listEventsForChild(tx, {
      workspaceId,
      childId,
      cursor,
      // One extra row decides whether another page exists without a second count query.
      limit: query.limit + 1,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
    });
  });

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  // Every row on a page shares one data key; the wrapper resolves it once for this read.
  const scoped: ServiceDeps = { ...deps, keys: withRequestKeyCache(deps.keys) };
  // One query for the page's current revisions. Each row's published attachments and its source
  // quote live in that snapshot rather than in the projection, so the page decrypts them once.
  const snapshots = await withTenantTransaction(scoped.db, { workspaceId }, (tx) =>
    readCurrentSnapshots(tx, scoped, { workspaceId, childId, rows: page }),
  );
  return {
    items: await Promise.all(
      page.map((row) => decryptToDto(scoped, row, snapshots.get(row.id) ?? null)),
    ),
    nextCursor: rows.length > query.limit && last !== undefined ? encodeEventCursor(last) : null,
  };
}

export async function getEvent({
  deps,
  actorUserId,
  eventId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  eventId: string;
}): Promise<EventDto> {
  const { workspaceId, childId } = await resolveEventLocation({ deps, actorUserId, eventId });
  return withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
    const row = await eventsRepository.findEventInChild(tx, workspaceId, childId, eventId);
    if (row === null) throw ApiHttpError.notFound("That entry is not available");
    return decryptToDto(deps, row, await readCurrentSnapshot(tx, deps, row));
  });
}

export function correctEvent({
  deps,
  actorUserId,
  eventId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  eventId: string;
  input: UpdateEventRequest;
  /** Supplied by an idempotent route so this write and its replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<EventDto> {
  return publishChange({
    deps,
    actorUserId,
    eventId,
    expectedVersion: input.expectedVersion,
    operation: "corrected",
    action: "event.corrected",
    tx,
    apply: (current) => applyEventPatch(current, input),
  });
}

export function deleteEvent({
  deps,
  actorUserId,
  eventId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  eventId: string;
  input: DeleteEventRequest;
  tx?: ScopedTransaction;
}): Promise<EventDto> {
  return publishChange({
    deps,
    actorUserId,
    eventId,
    expectedVersion: input.expectedVersion,
    operation: "deleted",
    action: "event.deleted",
    tx,
    // Values are preserved: a deletion is a published state change, not an erasure of history.
    apply: (current) => ({ ...current, status: "deleted" }),
  });
}

/** Lock the child, allocate the sequence, encrypt, append the revision, audit. */
async function publishChange({
  deps,
  actorUserId,
  eventId,
  expectedVersion,
  operation,
  action,
  tx,
  apply,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  eventId: string;
  expectedVersion: number;
  operation: RevisionOperation;
  action: string;
  tx: ScopedTransaction | undefined;
  apply: (current: EventFacts) => EventFacts;
}): Promise<EventDto> {
  const location = await resolveEventLocation({ deps, actorUserId, eventId });
  const { workspaceId, childId } = location;

  return inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const authorization = await authorizeChild(scoped, {
      userId: actorUserId,
      workspaceId,
      childId,
    });
    const row = await eventsRepository.findEventInChild(scoped, workspaceId, childId, eventId);
    if (row === null) throw ApiHttpError.notFound("That entry is not available");

    const context = accessContextOf(authorization.membership.appRole, authorization.permission);
    if (!canCorrectEvent({ ctx: context, isAuthor: row.createdByUserId === actorUserId })) {
      throw ApiHttpError.forbidden("You cannot change this entry");
    }
    if (row.status === "deleted") throw ApiHttpError.conflict("This entry was already removed");

    const payload = await decryptEventPayload(deps.keys, {
      workspaceId,
      eventId,
      envelope: row.payloadCiphertext,
    });
    const facts = apply(eventFactsFromRow(row, payload));
    const result = validateEventSemantics(semanticsInputOf(facts));
    if (!result.ok) {
      const fieldErrors: Record<string, string[]> = {};
      for (const error of result.errors) (fieldErrors[error.field] ??= []).push(error.message);
      throw ApiHttpError.validationFailed("That change cannot be saved as written", fieldErrors);
    }

    const locked = await eventsRepository.lockChildForJournalWrite(scoped, workspaceId, childId);
    if (locked === null) throw ApiHttpError.notFound("That child is not available");
    const journalSeq = await eventsRepository.allocateJournalSeq(scoped, workspaceId, childId);
    const revisionId = randomUUID();
    // Carried over from the revision being replaced, so a correction keeps citing its source and
    // keeps the attachments already published on this entry.
    const current = await readCurrentSnapshot(scoped, deps, row);
    const sourceQuote = current?.sourceQuote ?? null;
    const readyAssetIds = current?.readyAssetIds ?? [];

    const updated = await eventsRepository.appendEventRevision(scoped, {
      workspaceId,
      childId,
      eventId,
      expectedVersion,
      patch: {
        occurredAt: facts.occurredAt,
        endedAt: facts.endedAt,
        timezone: facts.timezone,
        timePrecision: facts.timePrecision,
        payloadCiphertext: await encryptEventPayload(deps.keys, {
          workspaceId,
          eventId,
          payload: eventPayloadOf(facts),
        }),
        important: facts.important,
        status: facts.status,
      },
      revision: {
        id: revisionId,
        journalSeq,
        operation,
        actorUserId,
        contentCiphertext: await encryptRevisionSnapshot(deps.keys, {
          workspaceId,
          revisionId,
          snapshot: revisionSnapshotOf(facts, sourceQuote, readyAssetIds),
        }),
      },
    });
    if (updated === null) throw ApiHttpError.conflict("This entry changed since you loaded it");

    await infrastructureRepository.insertAuditLog(scoped, {
      workspaceId,
      childId,
      actorUserId,
      action,
      entityType: "event",
      entityId: eventId,
      requestId: deps.requestId,
    });
    return toEventDto(updated, eventPayloadOf(facts), sourceQuote, readyAssetIds);
  });
}

async function decryptToDto(
  deps: ServiceDeps,
  row: EventRow,
  snapshot: RevisionSnapshot | null,
): Promise<EventDto> {
  const payload = await decryptEventPayload(deps.keys, {
    workspaceId: row.workspaceId,
    eventId: row.id,
    envelope: row.payloadCiphertext,
  });
  return toEventDto(row, payload, snapshot?.sourceQuote ?? null, snapshot?.readyAssetIds ?? []);
}

/** One event's revisions are a short list; the current one carries what a reader is shown. */
async function readCurrentSnapshot(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  row: EventRow,
): Promise<RevisionSnapshot | null> {
  const revisions = await eventsRepository.listRevisionsForEvent(
    tx,
    row.workspaceId,
    row.childId,
    row.id,
  );
  const current = revisions.find((revision) => revision.id === row.currentRevisionId);
  if (current === undefined) return null;
  return decryptRevisionSnapshot(deps.keys, {
    workspaceId: row.workspaceId,
    revisionId: current.id,
    envelope: current.contentCiphertext,
  });
}

/** The current snapshot of every row on one page, keyed by event id, from one revision query. */
async function readCurrentSnapshots(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  input: { workspaceId: string; childId: string; rows: readonly EventRow[] },
): Promise<Map<string, RevisionSnapshot>> {
  const revisions = await eventsRepository.listRevisionsByIds(
    tx,
    input.workspaceId,
    input.childId,
    input.rows.map((row) => row.currentRevisionId),
  );
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const snapshots = new Map<string, RevisionSnapshot>();
  for (const row of input.rows) {
    const current = byId.get(row.currentRevisionId);
    if (current === undefined) continue;
    snapshots.set(
      row.id,
      await decryptRevisionSnapshot(deps.keys, {
        workspaceId: input.workspaceId,
        revisionId: current.id,
        envelope: current.contentCiphertext,
      }),
    );
  }
  return snapshots;
}
