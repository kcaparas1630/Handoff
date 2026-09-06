import { and, eq, inArray, sql } from "drizzle-orm";
import { invitationChildGrants, invitationIntents } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type {
  InvitationChildGrantRow,
  InvitationIntentRow,
  InvitationStatusUpdate,
  NewInvitationChildGrant,
  NewInvitationIntent,
} from "../types/invitations";

const openStatuses = ["pending_send", "sent", "reconcile_needed"] as const;

export async function insertInvitationIntent(
  tx: HandoffTransaction,
  input: NewInvitationIntent,
): Promise<InvitationIntentRow> {
  const [row] = await tx.insert(invitationIntents).values(input).returning();
  if (!row) throw new Error("insertInvitationIntent returned no row");
  return row;
}

export async function findInvitationById(
  tx: HandoffTransaction,
  workspaceId: string,
  invitationId: string,
): Promise<InvitationIntentRow | null> {
  const [row] = await tx
    .select()
    .from(invitationIntents)
    .where(
      and(eq(invitationIntents.workspaceId, workspaceId), eq(invitationIntents.id, invitationId)),
    )
    .limit(1);
  return row ?? null;
}

/** A lookup-hash match is only a candidate: the caller still verifies the recipient identity. */
export async function findPendingInvitationByLookupHash(
  tx: HandoffTransaction,
  workspaceId: string,
  emailLookupHash: Uint8Array,
): Promise<InvitationIntentRow | null> {
  const [row] = await tx
    .select()
    .from(invitationIntents)
    .where(
      and(
        eq(invitationIntents.workspaceId, workspaceId),
        eq(invitationIntents.emailLookupHash, emailLookupHash),
        inArray(invitationIntents.status, [...openStatuses]),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updateInvitationStatus(
  tx: HandoffTransaction,
  input: InvitationStatusUpdate,
): Promise<InvitationIntentRow | null> {
  const [row] = await tx
    .update(invitationIntents)
    .set({
      status: input.status,
      ...(input.clerkInvitationId === undefined
        ? {}
        : { clerkInvitationId: input.clerkInvitationId }),
      ...(input.acceptedByUserId === undefined ? {} : { acceptedByUserId: input.acceptedByUserId }),
      ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
      updatedAt: sql`now()`,
      version: sql`${invitationIntents.version} + 1`,
    })
    .where(
      and(
        eq(invitationIntents.workspaceId, input.workspaceId),
        eq(invitationIntents.id, input.invitationId),
        eq(invitationIntents.version, input.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}

export async function insertInvitationChildGrants(
  tx: HandoffTransaction,
  grants: NewInvitationChildGrant[],
): Promise<InvitationChildGrantRow[]> {
  if (grants.length === 0) return [];
  return tx.insert(invitationChildGrants).values(grants).returning();
}

export async function listInvitationChildGrants(
  tx: HandoffTransaction,
  workspaceId: string,
  invitationId: string,
): Promise<InvitationChildGrantRow[]> {
  return tx
    .select()
    .from(invitationChildGrants)
    .where(
      and(
        eq(invitationChildGrants.workspaceId, workspaceId),
        eq(invitationChildGrants.invitationIntentId, invitationId),
      ),
    )
    .orderBy(invitationChildGrants.childId);
}

export async function listInvitationsForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<InvitationIntentRow[]> {
  return tx
    .select()
    .from(invitationIntents)
    .where(eq(invitationIntents.workspaceId, workspaceId))
    .orderBy(invitationIntents.createdAt, invitationIntents.id);
}
