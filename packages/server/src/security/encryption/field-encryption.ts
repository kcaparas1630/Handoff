// Column-level API used by services: JSON payload in, validated ciphertext envelope out.
import { Buffer } from "node:buffer";
import { ciphertextEnvelopeSchema } from "../../schemas/ciphertext-envelope";
import type { CiphertextEnvelope, EncryptionScope, RecordContext } from "../../types/encryption";
import type { DataKeyService } from "./data-keys";
import { decryptAesGcm, encryptAesGcm } from "./aes-gcm";
import { encodeAdditionalData } from "./lib/encryption-context";
import { EncryptionError } from "./errors";

const FORMAT_VERSION = 1;
const ALGORITHM = "A256GCM";

/** The payload carries its own `schemaVersion`; this layer does not add or read one. */
export async function encryptField({
  keys,
  scope,
  record,
  payload,
}: {
  keys: DataKeyService;
  scope: EncryptionScope;
  record: RecordContext;
  payload: unknown;
}): Promise<CiphertextEnvelope> {
  const json = JSON.stringify(payload);
  if (typeof json !== "string") {
    throw new EncryptionError("invalid_envelope", "payload is not JSON serializable");
  }
  const { keyId, key } = await keys.getEncryptionKey(scope);
  const additionalData = encodeAdditionalData({
    scope,
    record,
    formatVersion: FORMAT_VERSION,
    keyId,
  });
  const parts = encryptAesGcm(Buffer.from(json, "utf8"), key, additionalData);
  return {
    formatVersion: FORMAT_VERSION,
    algorithm: ALGORITHM,
    keyId,
    nonce: parts.nonce.toString("base64"),
    ciphertext: parts.ciphertext.toString("base64"),
    tag: parts.tag.toString("base64"),
  };
}

/** Validates the envelope, authenticates, then parses. Callers validate the parsed payload. */
export async function decryptField({
  keys,
  scope,
  record,
  envelope,
}: {
  keys: DataKeyService;
  scope: EncryptionScope;
  record: RecordContext;
  envelope: unknown;
}): Promise<unknown> {
  const parsed = ciphertextEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new EncryptionError("invalid_envelope", "the stored envelope is not supported");
  }
  const { formatVersion, keyId, nonce, ciphertext, tag } = parsed.data;
  const key = await keys.getDecryptionKey(keyId, scope);
  const additionalData = encodeAdditionalData({ scope, record, formatVersion, keyId });
  const plaintext = decryptAesGcm(
    {
      nonce: Buffer.from(nonce, "base64"),
      ciphertext: Buffer.from(ciphertext, "base64"),
      tag: Buffer.from(tag, "base64"),
    },
    key,
    additionalData,
  );
  try {
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  } catch {
    throw new EncryptionError("invalid_envelope", "decrypted payload is not valid JSON");
  }
}
