// Drizzle schema, transactions, and repositories; imported by server code only.
export * as schema from "./schema";
export { createDbClient } from "./client";
export type { DbClient, DbClientOptions } from "./client";
export {
  setIdentityContext,
  withIdentityTransaction,
  withJobTransaction,
  withTenantTransaction,
} from "./tenant-transaction";
export type { IdentityContext, IsolationLevel, TenantContext } from "./tenant-transaction";
// runMigrations is intentionally not re-exported: it resolves the migrations folder from disk
// and is a CLI concern. Tooling and tests import ./migrate directly so the API bundle stays clean.

export * as dataKeyRepository from "./repositories/data-keys";
export * as identityRepository from "./repositories/identity";
export * as childrenRepository from "./repositories/children";
export * as invitationsRepository from "./repositories/invitations";
export * as infrastructureRepository from "./repositories/infrastructure";
export * as capturesRepository from "./repositories/captures";
export * as eventsRepository from "./repositories/events";
export * as careRepository from "./repositories/care";
export * as handoffsRepository from "./repositories/handoffs";
export * as overviewRepository from "./repositories/overview";
export * as mediaRepository from "./repositories/media";
export * as storageQuotaRepository from "./repositories/storage-quota";
export * as jobsRepository from "./repositories/jobs";
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
  BriefStatus,
  CaptureInputKind,
  CaptureStatus,
  CareEndReason,
  CaregiverRelationship,
  ChildPermission,
  ChildStatus,
  EventKind,
  EventStatus,
  InvitationStatus,
  JobKind,
  JobStatus,
  MediaCleanupState,
  MediaKind,
  MediaStatus,
  MembershipStatus,
  RevisionOperation,
  TimePrecision,
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
export type {
  AppendRevisionInput,
  CaptureDraftUpdate,
  CaptureRow,
  CaptureStatusUpdate,
  EventCursor,
  EventPatch,
  EventRevisionRow,
  EventRow,
  ListEventsQuery,
  NewCapture,
  NewEvent,
  NewEventRevision,
} from "./types/journal";
export type {
  AdvanceCursor,
  CareSessionRow,
  HandoffBriefRow,
  HandoffCursorRow,
  NewHandoffBrief,
  OverviewMetadata,
  StartCareSession,
  StartedCareSession,
} from "./types/care";
export type {
  MediaAssetLookup,
  MediaAssetRow,
  MediaUploadResult,
  NewMediaAsset,
  WorkspaceStorageRow,
} from "./types/media";
export type {
  ClaimJobInput,
  EnqueueJobInput,
  EnqueueJobResult,
  JobFailure,
  JobRow,
  LeasedJobWrite,
} from "./types/jobs";
