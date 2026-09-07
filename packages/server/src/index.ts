// Use cases, verified auth, provider adapters, and job handlers; server-side only.
export { decryptAesGcm, encryptAesGcm } from "./security/encryption/aes-gcm";
export type { AesGcmParts } from "./security/encryption/aes-gcm";
export { createDataKeyService } from "./security/encryption/data-keys";
export type { DataKeyService, DataKeyServiceOptions } from "./security/encryption/data-keys";
export { createDevelopmentKeyWrapper } from "./security/encryption/development-key-wrapper";
export { createKmsKeyWrapper } from "./security/encryption/kms-key-wrapper";
export { decryptField, encryptField } from "./security/encryption/field-encryption";
export { EncryptionError } from "./security/encryption/errors";
export type { EncryptionErrorCode } from "./security/encryption/errors";
export {
  encodeAdditionalData,
  encodeWrappingContext,
  encodeWrappingContextAad,
} from "./security/encryption/lib/encryption-context";
export {
  canonicalizeEmail,
  computeInvitationLookupHash,
  computeRequestFingerprint,
} from "./security/encryption/lib/invitation-lookup";
export {
  createTransactionDataKeyService,
  createTransactionDataKeyStore,
} from "./security/transaction-data-keys";
export { ciphertextEnvelopeSchema } from "./schemas/ciphertext-envelope";
export type {
  CiphertextEnvelope,
  DataKeyCandidate,
  DataKeyPurpose,
  DataKeyRecord,
  DataKeyState,
  DataKeyStore,
  EncryptionKeyMaterial,
  EncryptionScope,
  KeyWrapper,
  RecordContext,
  WrappedKeyMaterial,
  WrappingContext,
} from "./types/encryption";

export { loadServerEnv, requireStorageEnv, requireWorkerEnv, ServerEnvError } from "./config/env";
export type { StorageEnv, WorkerEnv } from "./config/env";
export { serverEnvSchema } from "./schemas/server-env";
export type { PiiKeyProvider, ServerEnv } from "./types/server-env";

export { createRequestDeps, createServerRuntime, createWorkerRuntime } from "./runtime";
export type { RuntimeLimits, ServerRuntime, ServiceDeps, WorkerRuntime } from "./types/runtime";

export { createSupabaseStorage } from "./storage/supabase-storage";
export type {
  ObjectStorage,
  StoredObjectHead,
  StoredObjectSummary,
  UploadAuthorizationRequest,
  UploadAuthorizationResult,
} from "./storage/object-storage";
export { createDeepgramTranscription } from "./transcription/deepgram";
export type {
  TranscriptionProvider,
  TranscriptionRequest,
  TranscriptionResult,
} from "./transcription/provider";
export { createAnthropicExtraction } from "./ai/anthropic";
export type { ExtractionProvider, ExtractionResult } from "./ai/extract-events";
export { PROMPT_VERSION } from "./ai/prompts/extract-events-v1";
export { validateExtractionSemantics } from "./ai/lib/validate-extraction";
export { buildDraftCandidates } from "./jobs/lib/draft-candidates";
export { ProviderError } from "./lib/provider-error";
export type { ProviderErrorCode } from "./lib/provider-error";
export {
  assetIdFromObjectKey,
  buildNormalizedImageKey,
  childObjectPrefix,
  buildObjectKey,
  objectExtensionForMime,
  workspaceObjectPrefix,
} from "./lib/object-key";

export { createLogger, isAllowedLogField } from "./observability/logger";
export {
  createMetrics,
  formatSnapshotLine,
  recordStorageLevels,
  startMetricsDump,
  AUDIO_SECONDS_COUNTER,
  TOKENS_IN_COUNTER,
  TOKENS_OUT_COUNTER,
} from "./observability/metrics";
export type {
  LogFields,
  LogLevel,
  Logger,
  LoggerOptions,
  MetricLabels,
  MetricsRegistry,
  MetricsSnapshot,
} from "./types/observability";
export {
  estimateProviderSpendUsd,
  PROVIDER_RATES,
  ANTHROPIC_INPUT_USD_PER_MTOK,
  ANTHROPIC_OUTPUT_USD_PER_MTOK,
  DEEPGRAM_PLACEHOLDER_USD_PER_AUDIO_SECOND,
} from "./lib/provider-rates";
export type { ProviderRates, ProviderUsageTotals } from "./lib/provider-rates";

export { createJobRunner } from "./jobs/runner";
export { processCapture } from "./jobs/process-capture";
export { reconcileClerk, scheduleReconciliation } from "./jobs/reconcile-clerk";
export { cleanupAudio, scheduleAudioCleanup } from "./jobs/cleanup-audio";
export { cleanupUploads, scheduleUploadCleanup } from "./jobs/cleanup-uploads";
export { validateMedia } from "./jobs/validate-media";
export { purgeChild, purgeChildData } from "./jobs/purge-child";
export { purgeWorkspace } from "./jobs/purge-workspace";
export { rotateDataKeys } from "./jobs/rotate-data-keys";
export { inspectMedia, isRejected } from "./media/inspect";
export type { InspectedMedia, MediaInspection, MediaRejection } from "./media/inspect";
export { normalizeImage, NORMALIZED_MAX_EDGE, NORMALIZED_MIME } from "./media/normalize-image";
export { inspectMp4Container } from "./media/lib/mp4-duration";
export {
  attachmentLimitsFor,
  attachmentLimitsForAsset,
  IMAGE_LIMITS,
  VIDEO_LIMITS,
} from "./media/lib/attachment-limits";
export type { AttachmentLimits } from "./media/lib/attachment-limits";
export type { JobContext, JobHandler, JobOutcome, JobRunner, JobRunnerOptions } from "./types/jobs";

export { ApiHttpError, toErrorResponse } from "./http/errors";
export { createHandler } from "./http/handler";
export { inTenantTransaction } from "./lib/in-tenant-transaction";
export type { ScopedTransaction } from "./lib/in-tenant-transaction";
export { decodeEventCursor, encodeEventCursor } from "./lib/event-cursor";
export { runIdempotent } from "./http/idempotency";
export type { IdempotentResult } from "./http/idempotency";
export type {
  AuthMode,
  AuthenticatedUser,
  HandlerAuth,
  HandlerContext,
  HandlerOptions,
} from "./types/http";

export { createClerkGateway } from "./auth/clerk";
export { authorizeChild, authorizeWorkspace } from "./auth/authorize";
export type { ChildAuthorization, WorkspaceAuthorization } from "./types/authorization";
export type { ClerkGateway, ClerkMembership, ClerkSubject } from "./types/clerk";
export {
  isClerkOrgAdmin,
  mapAppRoleToClerkRole,
  mapClerkRoleToAppRole,
} from "./lib/map-clerk-role";

export { bootstrap } from "./services/bootstrap";
export { initializeWorkspace } from "./services/workspaces";
export { createChild, getChild, listChildren, updateChild } from "./services/children";
export { listChildCaregivers, updateChildCaregivers } from "./services/child-caregivers";
export {
  createInvitation,
  getInvitation,
  listInvitations,
  revokeInvitation,
} from "./services/invitations";
export { applyAcceptedInvitation } from "./services/invitation-acceptance";
export type { InvitationApplication } from "./services/invitation-acceptance";
export { listMembers, refreshMembershipIfStale, revokeMember } from "./services/memberships";
export {
  resolveAssetLocation,
  resolveBriefWorkspace,
  resolveCaptureWorkspace,
  resolveChildWorkspace,
  resolveEventLocation,
  resolveInvitationWorkspace,
} from "./services/workspace-lookup";
export { createCapture, getCapture, updateCaptureDraft } from "./services/captures";
export { completeUpload, retryCapture } from "./services/uploads";
export {
  completeAssetUpload,
  createAssetUpload,
  getAssetReadUrl,
  listAssetsForEvent,
} from "./services/media";
export {
  cleanupAudioDedupeKey,
  cleanupUploadsDedupeKey,
  processCaptureDedupeKey,
  purgeChildDedupeKey,
  purgeWorkspaceDedupeKey,
  reconcileClerkDedupeKey,
  rotateDataKeysDedupeKey,
  validateMediaDedupeKey,
} from "./services/job-keys";
export { confirmCapture } from "./services/capture-confirmation";
export { correctEvent, deleteEvent, getEvent, listEvents } from "./services/events";
export { endCare, listCare, startCare } from "./services/care";
export { createBrief, getBrief } from "./services/handoffs";
export { acknowledgeBrief } from "./services/handoff-acknowledgement";
export { getOverview } from "./services/overview";
export { deleteChild, deleteWorkspace } from "./services/deletion";
export type { ChildDeletionResult, WorkspaceDeletionResult } from "./services/deletion";
export { updateSelf } from "./services/self";
export {
  assertAudioQuota,
  assertCaptureQuota,
  assertExtractionBudget,
  BudgetExceededError,
  recordProviderUsage,
  startOfUtcDay,
  utcDay,
} from "./services/quotas";
export {
  convertEnvelopeBatch,
  retireWorkspaceKeyIfUnused,
  retireWorkspaceKeysIfDue,
  rewrapDataKeys,
  rotateWorkspaceContentKey,
  ROTATABLE_TABLES,
} from "./services/key-rotation";
export { redactedBriefSnapshot } from "./lib/redacted-snapshot";
export { handleClerkWebhook } from "./services/clerk-webhooks";
export type { WebhookOutcome } from "./services/clerk-webhooks";
export {
  decryptBriefSnapshot,
  decryptCaptureDraft,
  decryptEventPayload,
  decryptRevisionSnapshot,
  encryptBriefSnapshot,
  encryptCaptureDraft,
  encryptEventPayload,
  encryptRevisionSnapshot,
} from "./security/journal-fields";
export {
  CHILD_PROFILE_TOMBSTONE,
  decryptChildProfileEnvelope,
  encryptChildTombstone,
} from "./security/profile-fields";
export {
  childProfilePayloadSchema,
  idempotentResponsePayloadSchema,
  inviteePayloadSchema,
  userProfilePayloadSchema,
  workspaceProfilePayloadSchema,
} from "./schemas/profiles";
