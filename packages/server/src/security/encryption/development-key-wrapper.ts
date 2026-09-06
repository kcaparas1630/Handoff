// Local wrapping adapter for synthetic development and tests only.
import { Buffer } from "node:buffer";
import type { KeyWrapper, WrappedKeyMaterial, WrappingContext } from "../../types/encryption";
import { decryptAesGcm, encryptAesGcm } from "./aes-gcm";
import { encodeWrappingContextAad } from "./lib/encryption-context";
import { EncryptionError } from "./errors";

const KEK_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const WRAPPING_KEY_REF = "dev-local";

/**
 * The caller supplies the KEK; this module never reads configuration. `config/env.ts`
 * decides which wrapper to build and rejects this one in production.
 */
export function createDevelopmentKeyWrapper(kekBase64: string): KeyWrapper {
  const kek = Buffer.from(kekBase64, "base64");
  if (kek.length !== KEK_BYTES) {
    throw new EncryptionError("invalid_key", "development wrapping key must decode to 32 bytes");
  }

  return {
    provider: "development",

    wrap(rawKey: Uint8Array, wrappingContext: WrappingContext): Promise<WrappedKeyMaterial> {
      const parts = encryptAesGcm(
        Buffer.from(rawKey),
        kek,
        encodeWrappingContextAad(wrappingContext),
      );
      // Wrapped layout: 12-byte nonce || ciphertext || 16-byte tag.
      const wrappedKey = Buffer.concat([parts.nonce, parts.ciphertext, parts.tag]);
      return Promise.resolve({ wrappedKey, wrappingKeyRef: WRAPPING_KEY_REF });
    },

    unwrap(wrappedKey: Uint8Array, wrappingContext: WrappingContext): Promise<Uint8Array> {
      const bytes = Buffer.from(wrappedKey);
      if (bytes.length <= NONCE_BYTES + TAG_BYTES) {
        return Promise.reject(new EncryptionError("wrapper_failure", "wrapped key is too short"));
      }
      try {
        const rawKey = decryptAesGcm(
          {
            nonce: bytes.subarray(0, NONCE_BYTES),
            ciphertext: bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES),
            tag: bytes.subarray(bytes.length - TAG_BYTES),
          },
          kek,
          encodeWrappingContextAad(wrappingContext),
        );
        return Promise.resolve(rawKey);
      } catch {
        return Promise.reject(
          new EncryptionError("wrapper_failure", "could not unwrap the data key"),
        );
      }
    },
  };
}
