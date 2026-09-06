// Pure projections of one event's canonical values into the transport DTO, the immutable
// revision snapshot, and the domain rule input, plus the merge a correction applies to them.
import type {
  EventDto,
  EventPayload,
  RevisionEvent,
  RevisionSnapshot,
  UpdateEventRequest,
} from "@handoff/contracts";
import type { EventRow } from "@handoff/db";
import type { EventSemanticsInput } from "@handoff/domain";
import type { EventFacts } from "../types/journal";

export function eventFactsFromRow(row: EventRow, payload: EventPayload): EventFacts {
  return {
    kind: row.kind,
    occurredAt: row.occurredAt,
    endedAt: row.endedAt,
    timezone: row.timezone,
    timePrecision: row.timePrecision,
    amountValue: payload.amountValue,
    amountUnit: payload.amountUnit,
    details: payload.details,
    important: row.important,
    status: row.status,
  };
}

export function eventPayloadOf(facts: EventFacts): EventPayload {
  return {
    schemaVersion: 1,
    amountValue: facts.amountValue,
    amountUnit: facts.amountUnit,
    details: facts.details,
  };
}

export function semanticsInputOf(facts: EventFacts): EventSemanticsInput {
  return {
    kind: facts.kind,
    occurredAt: facts.occurredAt,
    endedAt: facts.endedAt,
    timePrecision: facts.timePrecision,
    amountValue: facts.amountValue,
    amountUnit: facts.amountUnit,
    details: facts.details,
  };
}

export function revisionEventOf(facts: EventFacts): RevisionEvent {
  return {
    kind: facts.kind,
    occurredAt: facts.occurredAt === null ? null : facts.occurredAt.toISOString(),
    endedAt: facts.endedAt === null ? null : facts.endedAt.toISOString(),
    timezone: facts.timezone,
    timePrecision: facts.timePrecision,
    amountValue: facts.amountValue,
    amountUnit: facts.amountUnit,
    details: facts.details,
    important: facts.important,
    status: facts.status,
  };
}

/** Media asset ids stay empty until milestone 4; a snapshot never holds a credential or URL. */
export function revisionSnapshotOf(
  facts: EventFacts,
  sourceQuote: string | null,
): RevisionSnapshot {
  return {
    schemaVersion: 1,
    event: revisionEventOf(facts),
    sourceQuote,
    readyAssetIds: [],
  };
}

export function toEventDto(
  row: EventRow,
  payload: EventPayload,
  sourceQuote: string | null,
): EventDto {
  return {
    id: row.id,
    childId: row.childId,
    workspaceId: row.workspaceId,
    captureId: row.captureId,
    kind: row.kind,
    occurredAt: row.occurredAt === null ? null : row.occurredAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    timezone: row.timezone,
    timePrecision: row.timePrecision,
    amountValue: payload.amountValue,
    amountUnit: payload.amountUnit,
    details: payload.details,
    important: row.important,
    status: row.status,
    version: row.version,
    createdByUserId: row.createdByUserId,
    lastEditedByUserId: row.lastEditedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    currentRevisionId: row.currentRevisionId,
    sourceQuote,
  };
}

/** Omitted fields keep their stored value; an explicit null clears one. */
export function applyEventPatch(current: EventFacts, input: UpdateEventRequest): EventFacts {
  return {
    ...current,
    occurredAt: patchInstant(current.occurredAt, input.occurredAt),
    endedAt: patchInstant(current.endedAt, input.endedAt),
    timezone: input.timezone ?? current.timezone,
    timePrecision: input.timePrecision ?? current.timePrecision,
    amountValue: input.amountValue === undefined ? current.amountValue : input.amountValue,
    amountUnit: input.amountUnit === undefined ? current.amountUnit : input.amountUnit,
    details: input.details ?? current.details,
    important: input.important ?? current.important,
  };
}

function patchInstant(current: Date | null, patch: string | null | undefined): Date | null {
  if (patch === undefined) return current;
  return patch === null ? null : new Date(patch);
}
