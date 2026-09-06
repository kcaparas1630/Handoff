// AES-256-GCM over raw bytes. No envelope, JSON, or key management concerns live here.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { EncryptionError } from "./errors";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface AesGcmParts {
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new EncryptionError("invalid_key", "expected a 256-bit key");
  }
}

/** Generates a fresh 96-bit nonce per call; nonces are never derived from record data. */
export function encryptAesGcm(plaintext: Buffer, key: Buffer, additionalData: Buffer): AesGcmParts {
  assertKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { nonce, ciphertext, tag: cipher.getAuthTag() };
}

/** Returns plaintext only after `final()` has verified the authentication tag. */
export function decryptAesGcm(parts: AesGcmParts, key: Buffer, additionalData: Buffer): Buffer {
  assertKey(key);
  if (parts.nonce.length !== NONCE_BYTES || parts.tag.length !== TAG_BYTES) {
    throw new EncryptionError("invalid_envelope", "unsupported nonce or tag length");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, parts.nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData);
    decipher.setAuthTag(parts.tag);
    return Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
  } catch {
    throw new EncryptionError("authentication_failed");
  }
}
