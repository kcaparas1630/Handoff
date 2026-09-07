import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  captures,
  children,
  eventRevisions,
  events,
  handoffBriefs,
  idempotencyRequests,
  invitationIntents,
} from "../schema";
import type { HandoffTransaction } from "../types/database";
import type { EnvelopeRef, RotatableTable } from "../types/envelopes";

// Bulk envelope maintenance for data-key rotation. Nothing here decrypts or interprets a payload:
// it selects ciphertext still written under one key id and swaps in ciphertext the caller produced
// under another. See packages/server/src/services/key-rotation.ts for the rules this enforces.
//
// Two invariants shape every statement:
//   - The batch predicate is also the cursor. A converted row stops matching `keyId = <old>`, so a
//     resumed job re-reads only what it has not done and can never convert the same row twice.
//   - The update carries the key id and nonce the batch read. A concurrent user edit rewrites both,
//     so the maintenance write matches nothing and the caregiver's correction stands.
//
// No row here bumps `version` or `updated_at`: re-encryption is not an edit, and a client holding
// an expected version must not lose its next write to it.

/** Ciphertext still written under `keyId`, oldest first, bounded by `limit`. */
export async function listEnvelopeBatch(
  tx: HandoffTransaction,
  input: { table: RotatableTable; workspaceId: string; keyId: string; limit: number },
): Promise<EnvelopeRef[]> {
  const { workspaceId, keyId, limit } = input;
  switch (input.table) {
    case "children": {
      const rows = await tx
        .select({ id: children.id, envelope: children.profileCiphertext })
        .from(children)
        .where(
          and(
            eq(children.workspaceId, workspaceId),
            sql`${children.profileCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(asc(children.id))
        .limit(limit);
      return rows.map((row) => ({ rowId: [row.id], envelope: row.envelope }));
    }
    case "invitation_intents": {
      const rows = await tx
        .select({ id: invitationIntents.id, envelope: invitationIntents.inviteeCiphertext })
        .from(invitationIntents)
        .where(
          and(
            eq(invitationIntents.workspaceId, workspaceId),
            sql`${invitationIntents.inviteeCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(asc(invitationIntents.id))
        .limit(limit);
      return rows.map((row) => ({ rowId: [row.id], envelope: row.envelope }));
    }
    case "captures": {
      const rows = await tx
        .select({ id: captures.id, envelope: captures.contentCiphertext })
        .from(captures)
        .where(
          and(
            eq(captures.workspaceId, workspaceId),
            isNotNull(captures.contentCiphertext),
            sql`${captures.contentCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(asc(captures.id))
        .limit(limit);
      return rows.map((row) => ({ rowId: [row.id], envelope: row.envelope }));
    }
    case "events": {
      const rows = await tx
        .select({ id: events.id, envelope: events.payloadCiphertext })
        .from(events)
        .where(
          and(
            eq(events.workspaceId, workspaceId),
            sql`${events.payloadCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(asc(events.id))
        .limit(limit);
      return rows.map((row) => ({ rowId: [row.id], envelope: row.envelope }));
    }
    case "event_revisions": {
      const rows = await tx
        .select({ id: eventRevisions.id, envelope: eventRevisions.contentCiphertext })
        .from(eventRevisions)
        .where(
          and(
            eq(eventRevisions.workspaceId, workspaceId),
            sql`${eventRevisions.contentCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(asc(eventRevisions.id))
        .limit(limit);
      return rows.map((row) => ({ rowId: [row.id], envelope: row.envelope }));
    }
    case "handoff_briefs": {
      const rows = await tx
        .select({ id: handoffBriefs.id, envelope: handoffBriefs.snapshotCiphertext })
        .from(handoffBriefs)
        .where(
          and(
            eq(handoffBriefs.workspaceId, workspaceId),
            sql`${handoffBriefs.snapshotCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(asc(handoffBriefs.id))
        .limit(limit);
      return rows.map((row) => ({ rowId: [row.id], envelope: row.envelope }));
    }
    case "idempotency_requests": {
      // Composite primary key, and only the workspace-scoped rows belong to a workspace key.
      const rows = await tx
        .select({
          actorUserId: idempotencyRequests.actorUserId,
          operation: idempotencyRequests.operation,
          key: idempotencyRequests.key,
          envelope: idempotencyRequests.responseCiphertext,
        })
        .from(idempotencyRequests)
        .where(
          and(
            eq(idempotencyRequests.scopeWorkspaceId, workspaceId),
            isNotNull(idempotencyRequests.responseCiphertext),
            sql`${idempotencyRequests.responseCiphertext}->>'keyId' = ${keyId}`,
          ),
        )
        .orderBy(
          asc(idempotencyRequests.actorUserId),
          asc(idempotencyRequests.operation),
          asc(idempotencyRequests.key),
        )
        .limit(limit);
      return rows.map((row) => ({
        rowId: [row.actorUserId, row.operation, row.key],
        envelope: row.envelope,
      }));
    }
  }
}

/** False when the row changed since the batch read it, which is a concurrent edit winning. */
export async function replaceEnvelope(
  tx: HandoffTransaction,
  input: {
    table: RotatableTable;
    workspaceId: string;
    rowId: string[];
    expectedKeyId: string;
    expectedNonce: string;
    envelope: unknown;
  },
): Promise<boolean> {
  const { workspaceId, expectedKeyId, expectedNonce, envelope } = input;
  const [id, operation, key] = input.rowId;
  if (id === undefined) throw new Error("replaceEnvelope was given an empty row id");

  switch (input.table) {
    case "children":
      return updated(
        tx
          .update(children)
          .set({ profileCiphertext: envelope })
          .where(
            and(
              eq(children.workspaceId, workspaceId),
              eq(children.id, id),
              sql`${children.profileCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${children.profileCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ id: children.id }),
      );
    case "invitation_intents":
      return updated(
        tx
          .update(invitationIntents)
          .set({ inviteeCiphertext: envelope })
          .where(
            and(
              eq(invitationIntents.workspaceId, workspaceId),
              eq(invitationIntents.id, id),
              sql`${invitationIntents.inviteeCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${invitationIntents.inviteeCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ id: invitationIntents.id }),
      );
    case "captures":
      return updated(
        tx
          .update(captures)
          .set({ contentCiphertext: envelope })
          .where(
            and(
              eq(captures.workspaceId, workspaceId),
              eq(captures.id, id),
              sql`${captures.contentCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${captures.contentCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ id: captures.id }),
      );
    case "events":
      return updated(
        tx
          .update(events)
          .set({ payloadCiphertext: envelope })
          .where(
            and(
              eq(events.workspaceId, workspaceId),
              eq(events.id, id),
              sql`${events.payloadCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${events.payloadCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ id: events.id }),
      );
    case "event_revisions":
      return updated(
        tx
          .update(eventRevisions)
          .set({ contentCiphertext: envelope })
          .where(
            and(
              eq(eventRevisions.workspaceId, workspaceId),
              eq(eventRevisions.id, id),
              sql`${eventRevisions.contentCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${eventRevisions.contentCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ id: eventRevisions.id }),
      );
    case "handoff_briefs":
      return updated(
        tx
          .update(handoffBriefs)
          .set({ snapshotCiphertext: envelope })
          .where(
            and(
              eq(handoffBriefs.workspaceId, workspaceId),
              eq(handoffBriefs.id, id),
              sql`${handoffBriefs.snapshotCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${handoffBriefs.snapshotCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ id: handoffBriefs.id }),
      );
    case "idempotency_requests": {
      if (operation === undefined || key === undefined) {
        throw new Error("replaceEnvelope needs the full idempotency_requests key");
      }
      return updated(
        tx
          .update(idempotencyRequests)
          .set({ responseCiphertext: envelope })
          .where(
            and(
              eq(idempotencyRequests.scopeWorkspaceId, workspaceId),
              eq(idempotencyRequests.actorUserId, id),
              eq(idempotencyRequests.operation, operation),
              eq(idempotencyRequests.key, key),
              sql`${idempotencyRequests.responseCiphertext}->>'keyId' = ${expectedKeyId}`,
              sql`${idempotencyRequests.responseCiphertext}->>'nonce' = ${expectedNonce}`,
            ),
          )
          .returning({ key: idempotencyRequests.key }),
      );
    }
  }
}

/** How many envelopes still name this key. A key is only retired when every table answers zero. */
export async function countEnvelopesForKey(
  tx: HandoffTransaction,
  input: { table: RotatableTable; workspaceId: string; keyId: string },
): Promise<number> {
  return (await listEnvelopeBatch(tx, { ...input, limit: MAX_COUNTED_REFERENCES })).length;
}

/**
 * Retirement asks "is this zero?", so the count is bounded: anything above the bound is simply
 * "still referenced", and the answer is the same.
 */
const MAX_COUNTED_REFERENCES = 1_000;

async function updated(run: Promise<unknown[]>): Promise<boolean> {
  return (await run).length > 0;
}
