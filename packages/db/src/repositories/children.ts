import { and, eq, sql } from "drizzle-orm";
import { childCaregivers, children } from "../schema";
import type {
  ChildCaregiverRow,
  ChildProfileUpdate,
  ChildRow,
  NewChild,
  UpsertChildCaregiver,
} from "../types/children";
import type { HandoffTransaction } from "../types/database";

export async function insertChild(tx: HandoffTransaction, input: NewChild): Promise<ChildRow> {
  const [row] = await tx.insert(children).values(input).returning();
  if (!row) throw new Error("insertChild returned no row");
  return row;
}

export async function findChildInWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<ChildRow | null> {
  const [row] = await tx
    .select()
    .from(children)
    .where(and(eq(children.workspaceId, workspaceId), eq(children.id, childId)))
    .limit(1);
  return row ?? null;
}

export async function listChildrenForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<ChildRow[]> {
  return tx
    .select()
    .from(children)
    .where(and(eq(children.workspaceId, workspaceId), eq(children.status, "active")))
    .orderBy(children.createdAt, children.id);
}

/** Children the user holds an active grant for. Owner-wide access is a service decision. */
export async function listChildrenGrantedToUser(
  tx: HandoffTransaction,
  workspaceId: string,
  userId: string,
): Promise<ChildRow[]> {
  return tx
    .select({
      id: children.id,
      workspaceId: children.workspaceId,
      profileCiphertext: children.profileCiphertext,
      createdByUserId: children.createdByUserId,
      journalSeq: children.journalSeq,
      status: children.status,
      createdAt: children.createdAt,
      updatedAt: children.updatedAt,
      version: children.version,
    })
    .from(childCaregivers)
    .innerJoin(
      children,
      and(
        eq(children.workspaceId, childCaregivers.workspaceId),
        eq(children.id, childCaregivers.childId),
      ),
    )
    .where(
      and(
        eq(childCaregivers.workspaceId, workspaceId),
        eq(childCaregivers.userId, userId),
        eq(childCaregivers.status, "active"),
        eq(children.status, "active"),
      ),
    )
    .orderBy(children.createdAt, children.id);
}

/** Returns null when the expected version no longer matches, so the caller can report a conflict. */
export async function updateChildProfile(
  tx: HandoffTransaction,
  input: ChildProfileUpdate,
): Promise<ChildRow | null> {
  const [row] = await tx
    .update(children)
    .set({
      profileCiphertext: input.profileCiphertext,
      updatedAt: sql`now()`,
      version: sql`${children.version} + 1`,
    })
    .where(
      and(
        eq(children.workspaceId, input.workspaceId),
        eq(children.id, input.childId),
        eq(children.version, input.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}

export async function upsertChildCaregiver(
  tx: HandoffTransaction,
  input: UpsertChildCaregiver,
): Promise<ChildCaregiverRow> {
  const [row] = await tx
    .insert(childCaregivers)
    .values(input)
    .onConflictDoUpdate({
      target: [childCaregivers.workspaceId, childCaregivers.childId, childCaregivers.userId],
      set: {
        relationship: input.relationship,
        permission: input.permission,
        status: "active",
        grantedByUserId: input.grantedByUserId,
        updatedAt: sql`now()`,
        version: sql`${childCaregivers.version} + 1`,
      },
    })
    .returning();
  if (!row) throw new Error("upsertChildCaregiver returned no row");
  return row;
}

export async function revokeChildCaregiver(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; userId: string },
): Promise<ChildCaregiverRow | null> {
  const [row] = await tx
    .update(childCaregivers)
    .set({
      status: "revoked",
      updatedAt: sql`now()`,
      version: sql`${childCaregivers.version} + 1`,
    })
    .where(
      and(
        eq(childCaregivers.workspaceId, input.workspaceId),
        eq(childCaregivers.childId, input.childId),
        eq(childCaregivers.userId, input.userId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function findChildCaregiver(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
  userId: string,
): Promise<ChildCaregiverRow | null> {
  const [row] = await tx
    .select()
    .from(childCaregivers)
    .where(
      and(
        eq(childCaregivers.workspaceId, workspaceId),
        eq(childCaregivers.childId, childId),
        eq(childCaregivers.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listChildCaregivers(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<ChildCaregiverRow[]> {
  return tx
    .select()
    .from(childCaregivers)
    .where(and(eq(childCaregivers.workspaceId, workspaceId), eq(childCaregivers.childId, childId)))
    .orderBy(childCaregivers.createdAt, childCaregivers.userId);
}
