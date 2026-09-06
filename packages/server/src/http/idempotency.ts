// Replay protection for state-changing requests. The stored response is encrypted and the
// request fingerprint is keyed, because bodies contain low-entropy personal values.
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { sql } from "drizzle-orm";
import { infrastructureRepository } from "@handoff/db";
import type { HandoffTransaction } from "@handoff/db";
import { ApiHttpError } from "./errors";
import { idempotentResponsePayloadSchema } from "../schemas/profiles";
import { idempotencyResponseRecord } from "../lib/record-contexts";
import { decryptField, encryptField } from "../security/encryption/field-encryption";
import { computeRequestFingerprint } from "../security/encryption/lib/invitation-lookup";
import type { DataKeyService } from "../security/encryption/data-keys";
import type { EncryptionScope } from "../types/encryption";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface IdempotentResult {
  status: number;
  /** Canonical response body. Never a signed URL: fresh authorization issues those. */
  body: unknown;
}

export async function runIdempotent({
  tx,
  keys,
  actor,
  operation,
  key,
  scope,
  requestBody,
  now,
  execute,
}: {
  tx: HandoffTransaction;
  keys: DataKeyService;
  actor: { userId: string };
  operation: string;
  key: string;
  scope: EncryptionScope;
  requestBody: string;
  now: () => Date;
  execute: (tx: HandoffTransaction) => Promise<IdempotentResult>;
}): Promise<IdempotentResult> {
  const lookupKey = await keys.getLookupKey(scope);
  const fingerprint = computeRequestFingerprint({
    lookupKey: lookupKey.key,
    actorUserId: actor.userId,
    operation,
    body: requestBody,
  });
  const record = idempotencyResponseRecord(actor.userId, operation, key);

  // Two requests that share a key arrive at the same moment often enough to matter: the second
  // would otherwise read no stored response and then fail on the primary key. This transaction
  // scoped lock makes it wait and replay instead. It is released at commit or rollback, and is
  // never held across an external call.
  const lockName = `${actor.userId}:${operation}:${key}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockName}))`);

  const stored = await infrastructureRepository.findIdempotencyRequest(
    tx,
    actor.userId,
    operation,
    key,
  );
  if (stored !== null) {
    const previous = Buffer.from(stored.requestFingerprint);
    const matches =
      previous.length === fingerprint.length && timingSafeEqual(previous, fingerprint);
    if (!matches) throw ApiHttpError.idempotencyKeyReused();
    const payload = idempotentResponsePayloadSchema.parse(
      await decryptField({ keys, scope, record, envelope: stored.responseCiphertext }),
    );
    return { status: payload.status, body: payload.body };
  }

  // Business writes and the retained response commit together, so a replay cannot observe one
  // without the other.
  const result = await execute(tx);
  const responseCiphertext = await encryptField({
    keys,
    scope,
    record,
    payload: { schemaVersion: 1, status: result.status, body: result.body },
  });
  await infrastructureRepository.insertIdempotencyRequest(tx, {
    actorUserId: actor.userId,
    operation,
    key,
    scopeKind: scope.kind,
    scopeWorkspaceId: scope.kind === "workspace" ? scope.workspaceId : null,
    requestFingerprint: fingerprint,
    fingerprintKeyId: lookupKey.keyId,
    responseStatus: result.status,
    responseCiphertext,
    expiresAt: new Date(now().getTime() + RETENTION_MS),
  });
  return result;
}
