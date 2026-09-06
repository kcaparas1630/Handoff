// Runtime validation for the stored JSONB ciphertext envelope; see docs/pii-encryption.md.
import { z } from "zod";

const base64WithByteLength = (byteLength: number) =>
  z.base64().refine((value) => Buffer.from(value, "base64").length === byteLength, {
    message: `expected ${String(byteLength)} bytes`,
  });

/** Only allowlisted versions/algorithms and exact nonce/tag lengths are accepted. */
export const ciphertextEnvelopeSchema = z.strictObject({
  formatVersion: z.literal(1),
  algorithm: z.literal("A256GCM"),
  keyId: z.uuid(),
  nonce: base64WithByteLength(12),
  ciphertext: z.base64(),
  tag: base64WithByteLength(16),
});
