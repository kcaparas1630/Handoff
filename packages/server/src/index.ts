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
