// Keyed equality indexes. These are sensitive lookup values, never plain email hashes.
import { createHmac } from "node:crypto";
import { encodeCanonicalFields } from "./encryption-context";
import { EncryptionError } from "../errors";

const LOOKUP_KEY_BYTES = 32;
const INVITATION_EMAIL_LABEL = "invitation-email";
const REQUEST_FINGERPRINT_LABEL = "request-fingerprint";

/** Matches the contracts email schema normalization exactly: `.trim().toLowerCase()`, nothing else. */
export function canonicalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function computeHmac(lookupKey: Buffer, fields: readonly string[]): Buffer {
  if (lookupKey.length !== LOOKUP_KEY_BYTES) {
    throw new EncryptionError("invalid_key", "expected a 256-bit lookup key");
  }
  return createHmac("sha256", lookupKey).update(encodeCanonicalFields(fields)).digest();
}

/** Equality index for pending invitations. A match is a candidate only, never authorization. */
export function computeInvitationLookupHash({
  lookupKey,
  workspaceId,
  email,
}: {
  lookupKey: Buffer;
  workspaceId: string;
  email: string;
}): Buffer {
  return computeHmac(lookupKey, [INVITATION_EMAIL_LABEL, workspaceId, canonicalizeEmail(email)]);
}

/** Idempotency fingerprint over a low-entropy body; a distinct domain label keeps it separate. */
export function computeRequestFingerprint({
  lookupKey,
  actorUserId,
  operation,
  body,
}: {
  lookupKey: Buffer;
  actorUserId: string;
  operation: string;
  body: string;
}): Buffer {
  return computeHmac(lookupKey, [REQUEST_FINGERPRINT_LABEL, actorUserId, operation, body]);
}
