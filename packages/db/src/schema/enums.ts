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
