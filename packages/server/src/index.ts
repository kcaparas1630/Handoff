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

export { loadServerEnv, ServerEnvError } from "./config/env";
export { serverEnvSchema } from "./schemas/server-env";
export type { PiiKeyProvider, ServerEnv } from "./types/server-env";

export { createRequestDeps, createServerRuntime } from "./runtime";
export type { ServerRuntime, ServiceDeps } from "./types/runtime";

export { ApiHttpError, toErrorResponse } from "./http/errors";
export { createHandler } from "./http/handler";
export { inTenantTransaction } from "./lib/in-tenant-transaction";
export type { ScopedTransaction } from "./lib/in-tenant-transaction";
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
export type {
  ChildAuthorization,
  ProviderFreshness,
  WorkspaceAuthorization,
} from "./types/authorization";
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
export { ensureFreshMembership, listMembers, revokeMember } from "./services/memberships";
export { resolveChildWorkspace, resolveInvitationWorkspace } from "./services/workspace-lookup";
export { handleClerkWebhook } from "./services/clerk-webhooks";
export type { WebhookOutcome } from "./services/clerk-webhooks";
export {
  childProfilePayloadSchema,
  idempotentResponsePayloadSchema,
  inviteePayloadSchema,
  userProfilePayloadSchema,
  workspaceProfilePayloadSchema,
} from "./schemas/profiles";
