import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { auditLog, idempotencyRequests, webhookInbox } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type {
  AuditLogRow,
  IdempotencyRequestRow,
  NewAuditLogEntry,
  NewIdempotencyRequest,
  NewWebhookInboxEntry,
} from "../types/infrastructure";

export async function findIdempotencyRequest(
  tx: HandoffTransaction,
  actorUserId: string,
  operation: string,
  key: string,
): Promise<IdempotencyRequestRow | null> {
  const [row] = await tx
    .select()
    .from(idempotencyRequests)
    .where(
      and(
        eq(idempotencyRequests.actorUserId, actorUserId),
        eq(idempotencyRequests.operation, operation),
        eq(idempotencyRequests.key, key),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertIdempotencyRequest(
  tx: HandoffTransaction,
  input: NewIdempotencyRequest,
): Promise<IdempotencyRequestRow> {
  const [row] = await tx.insert(idempotencyRequests).values(input).returning();
  if (!row) throw new Error("insertIdempotencyRequest returned no row");
  return row;
}

/** Returns false when the provider redelivered an event we already recorded. */
export async function insertWebhookInboxIfAbsent(
  tx: HandoffTransaction,
  input: NewWebhookInboxEntry,
): Promise<boolean> {
  const inserted = await tx
    .insert(webhookInbox)
    .values(input)
    .onConflictDoNothing({ target: [webhookInbox.provider, webhookInbox.eventId] })
    .returning({ eventId: webhookInbox.eventId });
  return inserted.length > 0;
}

export async function markWebhookProcessed(
  tx: HandoffTransaction,
  provider: string,
  eventId: string,
): Promise<void> {
  await tx
    .update(webhookInbox)
    .set({ status: "processed", processedAt: sql`now()` })
    .where(and(eq(webhookInbox.provider, provider), eq(webhookInbox.eventId, eventId)));
}

/**
 * Audit rows that record a provider call we could not complete, so a bounded reconciliation can
 * retry it. Ordered oldest first; the caller enqueues one job per row, keyed by that row's id.
 */
export async function listAuditLogByActions(
  tx: HandoffTransaction,
  input: { actions: string[]; limit: number },
): Promise<AuditLogRow[]> {
  return tx
    .select()
    .from(auditLog)
    .where(inArray(auditLog.action, input.actions))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
    .limit(input.limit);
}

export async function insertAuditLog(
  tx: HandoffTransaction,
  input: NewAuditLogEntry,
): Promise<AuditLogRow> {
  const [row] = await tx.insert(auditLog).values(input).returning();
  if (!row) throw new Error("insertAuditLog returned no row");
  return row;
}

/**
 * Serializes two requests that arrive under the same idempotency key at the same moment: the
 * second waits here and then reads the stored response instead of failing on the primary key.
 * Held until the transaction commits or rolls back, and never across an external call.
 */
export async function acquireIdempotencyLock(
  tx: HandoffTransaction,
  lockName: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockName}))`);
}
