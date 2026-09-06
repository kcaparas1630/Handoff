// Drizzle schema, transactions, and repositories; imported by server code only.
export * as schema from "./schema";
export { createDbClient } from "./client";
export type { DbClient, DbClientOptions } from "./client";
export {
  setIdentityContext,
  withIdentityTransaction,
  withTenantTransaction,
} from "./tenant-transaction";
export type { IdentityContext, TenantContext } from "./tenant-transaction";
// runMigrations is intentionally not re-exported: it resolves the migrations folder from disk
// and is a CLI concern. Tooling and tests import ./migrate directly so the API bundle stays clean.

export * as dataKeyRepository from "./repositories/data-keys";
export * as identityRepository from "./repositories/identity";
export * as childrenRepository from "./repositories/children";
export * as invitationsRepository from "./repositories/invitations";
export * as infrastructureRepository from "./repositories/infrastructure";
export { createDataKeyStore } from "./repositories/data-keys";

export type { HandoffDatabase, HandoffTransaction } from "./types/database";
export type {
  DataKeyPurpose,
  DataKeyRow,
  DataKeyScope,
  DataKeyState,
  DataKeyStorePort,
  NewDataKey,
} from "./types/data-keys";
export type {
  AppRole,
  CaregiverRelationship,
  ChildPermission,
  ChildStatus,
  InvitationStatus,
  MembershipStatus,
} from "./types/enums";
export type {
  MembershipWithWorkspace,
  NewUser,
  NewWorkspace,
  UpsertMembership,
  UserRow,
  WorkspaceMembershipRow,
  WorkspaceRow,
} from "./types/identity";
export type {
  ChildCaregiverRow,
  ChildProfileUpdate,
  ChildRow,
  NewChild,
  UpsertChildCaregiver,
} from "./types/children";
export type {
  InvitationChildGrantRow,
  InvitationIntentRow,
  InvitationStatusUpdate,
  NewInvitationChildGrant,
  NewInvitationIntent,
} from "./types/invitations";
export type {
  AuditLogRow,
  IdempotencyRequestRow,
  NewAuditLogEntry,
  NewIdempotencyRequest,
  NewWebhookInboxEntry,
  WebhookInboxRow,
} from "./types/infrastructure";
