import { handoffSchema } from "./handoff-schema";

// Postgres enums rather than checked text: the value sets are closed and shared across tables.
export const userStatus = handoffSchema.enum("user_status", ["active", "deleted"]);

export const workspaceKind = handoffSchema.enum("workspace_kind", ["household", "daycare"]);

export const workspaceStatus = handoffSchema.enum("workspace_status", [
  "active",
  "deleting",
  "deleted",
]);

export const appRole = handoffSchema.enum("app_role", ["owner", "staff", "caregiver", "guardian"]);

// Shared by workspace memberships and child grants; both use the same active|revoked lifecycle.
export const membershipStatus = handoffSchema.enum("membership_status", ["active", "revoked"]);

export const childStatus = handoffSchema.enum("child_status", [
  "active",
  "archived",
  "deleting",
  "deleted",
]);

export const caregiverRelationship = handoffSchema.enum("caregiver_relationship", [
  "parent",
  "relative",
  "caregiver",
  "other",
]);

export const childPermission = handoffSchema.enum("child_permission", [
  "reader",
  "contributor",
  "manager",
]);

export const invitationStatus = handoffSchema.enum("invitation_status", [
  "pending_send",
  "sent",
  "accepted",
  "revoked",
  "expired",
  "reconcile_needed",
]);

export const dataKeyPurpose = handoffSchema.enum("data_key_purpose", ["content", "lookup"]);

export const dataKeyState = handoffSchema.enum("data_key_state", [
  "active",
  "decrypt_only",
  "retired",
]);

export const encryptionScopeKind = handoffSchema.enum("encryption_scope_kind", [
  "workspace",
  "user",
]);

export const webhookStatus = handoffSchema.enum("webhook_status", [
  "received",
  "processed",
  "failed",
]);

export const captureInputKind = handoffSchema.enum("capture_input_kind", [
  "audio",
  "text",
  "manual",
]);

export const captureStatus = handoffSchema.enum("capture_status", [
  "awaiting_upload",
  "queued",
  "processing",
  "needs_review",
  "confirmed",
  "failed",
  "cancelled",
]);

export const eventKind = handoffSchema.enum("event_kind", [
  "feed",
  "diaper",
  "sleep",
  "milestone",
  "note",
]);

export const timePrecision = handoffSchema.enum("time_precision", [
  "exact",
  "approximate",
  "unknown",
]);

export const eventStatus = handoffSchema.enum("event_status", ["active", "deleted"]);

export const revisionOperation = handoffSchema.enum("revision_operation", [
  "created",
  "corrected",
  "deleted",
  "media_updated",
]);

export const careEndReason = handoffSchema.enum("care_end_reason", [
  "user_ended",
  "membership_revoked",
  "child_archived",
]);

export const briefStatus = handoffSchema.enum("brief_status", ["ready", "invalidated", "redacted"]);

export const mediaKind = handoffSchema.enum("media_kind", ["audio", "image", "video"]);

export const mediaStatus = handoffSchema.enum("media_status", [
  "pending_upload",
  "uploaded",
  "ready",
  "rejected",
  "deleting",
  "deleted",
]);

// Which one-time side effects an asset's reservation has already had, so a retried cleanup or a
// replayed validation cannot move the same bytes twice.
export const mediaCleanupState = handoffSchema.enum("media_cleanup_state", [
  "none",
  "object_deleted",
  "quota_released",
]);

export const jobKind = handoffSchema.enum("job_kind", [
  "process_capture",
  "validate_media",
  "reconcile_clerk",
  "cleanup_audio",
  "purge_child",
  "purge_workspace",
]);

export const jobStatus = handoffSchema.enum("job_status", [
  "queued",
  "leased",
  "succeeded",
  "failed",
  "cancelled",
]);
