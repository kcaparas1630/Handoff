// Canonical scope and record identities bound into ciphertext AAD. See docs/pii-encryption.md.
import type { EncryptionScope, RecordContext } from "../types/encryption";

export function workspaceScope(workspaceId: string): EncryptionScope {
  return { kind: "workspace", workspaceId };
}

export function userScope(userId: string): EncryptionScope {
  return { kind: "user", userId };
}

export function userProfileRecord(userId: string): RecordContext {
  return { table: "users", rowId: userId, column: "profile_ciphertext" };
}

export function workspaceProfileRecord(workspaceId: string): RecordContext {
  return { table: "workspaces", rowId: workspaceId, column: "profile_ciphertext" };
}

export function childProfileRecord(childId: string): RecordContext {
  return { table: "children", rowId: childId, column: "profile_ciphertext" };
}

export function invitationEmailRecord(invitationId: string): RecordContext {
  return { table: "invitation_intents", rowId: invitationId, column: "invitee_ciphertext" };
}

/** `idempotency_requests` has a composite primary key; its parts stay in declared order. */
export function idempotencyResponseRecord(
  actorUserId: string,
  operation: string,
  key: string,
): RecordContext {
  return {
    table: "idempotency_requests",
    rowId: [actorUserId, operation, key],
    column: "response_ciphertext",
  };
}

export function eventPayloadRecord(eventId: string): RecordContext {
  return { table: "events", rowId: eventId, column: "payload_ciphertext" };
}

export function revisionSnapshotRecord(revisionId: string): RecordContext {
  return { table: "event_revisions", rowId: revisionId, column: "content_ciphertext" };
}

export function captureDraftRecord(captureId: string): RecordContext {
  return { table: "captures", rowId: captureId, column: "content_ciphertext" };
}

export function briefSnapshotRecord(briefId: string): RecordContext {
  return { table: "handoff_briefs", rowId: briefId, column: "snapshot_ciphertext" };
}
