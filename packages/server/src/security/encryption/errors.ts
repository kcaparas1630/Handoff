export type EncryptionErrorCode =
  | "invalid_key"
  | "invalid_envelope"
  | "authentication_failed"
  | "key_unavailable"
  | "key_scope_mismatch"
  | "key_not_active"
  | "budget_exceeded"
  | "wrapper_failure";

/**
 * Single failure type for the encryption module. Messages are built from the code and an
 * optional static detail so key bytes, plaintext, and ciphertext can never reach a log.
 */
export class EncryptionError extends Error {
  readonly code: EncryptionErrorCode;

  constructor(code: EncryptionErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "EncryptionError";
    this.code = code;
  }
}
