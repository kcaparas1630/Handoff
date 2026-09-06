// Binds each protected journal column to its scope, record context, and payload schema.
// Callers must have authorized the row before calling any decrypt function here.
import {
  briefSnapshotSchema,
  captureDraftSchema,
  eventPayloadSchema,
  revisionSnapshotSchema,
} from "@handoff/contracts";
import type {
  BriefSnapshot,
  CaptureDraft,
  EventPayload,
  RevisionSnapshot,
} from "@handoff/contracts";
import { decryptField, encryptField } from "./encryption/field-encryption";
import {
  briefSnapshotRecord,
  captureDraftRecord,
  eventPayloadRecord,
  revisionSnapshotRecord,
  workspaceScope,
} from "../lib/record-contexts";
import type { DataKeyService } from "./encryption/data-keys";
import type { CiphertextEnvelope } from "../types/encryption";

/** Every journal payload lives under the workspace key: it is care data, not profile data. */
export function encryptEventPayload(
  keys: DataKeyService,
  input: { workspaceId: string; eventId: string; payload: EventPayload },
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: eventPayloadRecord(input.eventId),
    payload: eventPayloadSchema.parse(input.payload),
  });
}

export async function decryptEventPayload(
  keys: DataKeyService,
  input: { workspaceId: string; eventId: string; envelope: unknown },
): Promise<EventPayload> {
  const payload = await decryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: eventPayloadRecord(input.eventId),
    envelope: input.envelope,
  });
  return eventPayloadSchema.parse(payload);
}

export function encryptRevisionSnapshot(
  keys: DataKeyService,
  input: { workspaceId: string; revisionId: string; snapshot: RevisionSnapshot },
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: revisionSnapshotRecord(input.revisionId),
    payload: revisionSnapshotSchema.parse(input.snapshot),
  });
}

export async function decryptRevisionSnapshot(
  keys: DataKeyService,
  input: { workspaceId: string; revisionId: string; envelope: unknown },
): Promise<RevisionSnapshot> {
  const snapshot = await decryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: revisionSnapshotRecord(input.revisionId),
    envelope: input.envelope,
  });
  return revisionSnapshotSchema.parse(snapshot);
}

export function encryptCaptureDraft(
  keys: DataKeyService,
  input: { workspaceId: string; captureId: string; draft: CaptureDraft },
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: captureDraftRecord(input.captureId),
    payload: captureDraftSchema.parse(input.draft),
  });
}

export async function decryptCaptureDraft(
  keys: DataKeyService,
  input: { workspaceId: string; captureId: string; envelope: unknown },
): Promise<CaptureDraft> {
  const draft = await decryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: captureDraftRecord(input.captureId),
    envelope: input.envelope,
  });
  return captureDraftSchema.parse(draft);
}

export function encryptBriefSnapshot(
  keys: DataKeyService,
  input: { workspaceId: string; briefId: string; snapshot: BriefSnapshot },
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: briefSnapshotRecord(input.briefId),
    payload: briefSnapshotSchema.parse(input.snapshot),
  });
}

export async function decryptBriefSnapshot(
  keys: DataKeyService,
  input: { workspaceId: string; briefId: string; envelope: unknown },
): Promise<BriefSnapshot> {
  const snapshot = await decryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: briefSnapshotRecord(input.briefId),
    envelope: input.envelope,
  });
  return briefSnapshotSchema.parse(snapshot);
}
