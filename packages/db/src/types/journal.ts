import type {
  CaptureInputKind,
  CaptureStatus,
  EventKind,
  EventStatus,
  RevisionOperation,
  TimePrecision,
} from "./enums";

export interface CaptureRow {
  id: string;
  workspaceId: string;
  childId: string;
  authorUserId: string;
  careSessionId: string | null;
  clientCaptureId: string;
  inputKind: CaptureInputKind;
  capturedAt: Date;
  timezone: string;
  locale: string;
  // Raw transcript, formatted text, and the reviewable draft as a ciphertext envelope.
  contentCiphertext: unknown;
  draftVersion: number;
  schemaVersion: number;
  promptVersion: string | null;
  modelId: string | null;
  status: CaptureStatus;
  errorCode: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface NewCapture {
  id: string;
  workspaceId: string;
  childId: string;
  authorUserId: string;
  careSessionId?: string | null;
  clientCaptureId: string;
  inputKind: CaptureInputKind;
  capturedAt: Date;
  timezone: string;
  locale: string;
  contentCiphertext?: unknown;
  schemaVersion: number;
  status: CaptureStatus;
}

export interface CaptureDraftUpdate {
  workspaceId: string;
  captureId: string;
  expectedDraftVersion: number;
  contentCiphertext: unknown;
  status?: CaptureStatus;
  promptVersion?: string | null;
  modelId?: string | null;
}

export interface CaptureStatusUpdate {
  workspaceId: string;
  captureId: string;
  status: CaptureStatus;
  errorCode?: string | null;
}

export interface EventRow {
  id: string;
  workspaceId: string;
  childId: string;
  captureId: string;
  sourceCandidateId: string;
  createdByUserId: string;
  lastEditedByUserId: string;
  kind: EventKind;
  occurredAt: Date | null;
  endedAt: Date | null;
  timezone: string;
  timePrecision: TimePrecision;
  // Amount, unit, and kind-specific details as a ciphertext envelope.
  payloadCiphertext: unknown;
  important: boolean;
  status: EventStatus;
  currentRevisionId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

/** Both ids are allocated by the caller so the event and its first revision can reference each other. */
export interface NewEvent {
  id: string;
  workspaceId: string;
  childId: string;
  captureId: string;
  sourceCandidateId: string;
  createdByUserId: string;
  lastEditedByUserId: string;
  kind: EventKind;
  occurredAt: Date | null;
  endedAt: Date | null;
  timezone: string;
  timePrecision: TimePrecision;
  payloadCiphertext: unknown;
  important: boolean;
  currentRevisionId: string;
}

export interface EventRevisionRow {
  id: string;
  workspaceId: string;
  childId: string;
  eventId: string;
  journalSeq: number;
  eventVersion: number;
  operation: RevisionOperation;
  actorUserId: string;
  // Canonical snapshot and optional source quote as a ciphertext envelope.
  contentCiphertext: unknown;
  sourceStart: number | null;
  sourceEnd: number | null;
  createdAt: Date;
}

export interface NewEventRevision {
  id: string;
  workspaceId: string;
  childId: string;
  eventId: string;
  journalSeq: number;
  eventVersion: number;
  operation: RevisionOperation;
  actorUserId: string;
  contentCiphertext: unknown;
  sourceStart?: number | null;
  sourceEnd?: number | null;
}

/** The event fields a correction may replace. Kind, capture, and candidate never change. */
export interface EventPatch {
  occurredAt: Date | null;
  endedAt: Date | null;
  timezone: string;
  timePrecision: TimePrecision;
  payloadCiphertext: unknown;
  important: boolean;
  status: EventStatus;
}

/** The revision fields the caller supplies; `eventVersion` comes from the update that just ran. */
export interface AppendRevisionInput {
  id: string;
  journalSeq: number;
  operation: RevisionOperation;
  actorUserId: string;
  contentCiphertext: unknown;
  sourceStart?: number | null;
  sourceEnd?: number | null;
}

/** Keyset position in the `occurred_at DESC NULLS LAST, id DESC` timeline order. */
export interface EventCursor {
  occurredAt: Date | null;
  id: string;
}

export interface ListEventsQuery {
  workspaceId: string;
  childId: string;
  cursor: EventCursor | null;
  limit: number;
  kind?: EventKind;
  status?: EventStatus;
}
