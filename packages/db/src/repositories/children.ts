import { and, eq, inArray, sql } from "drizzle-orm";
import { childCaregivers, children, workspaceMemberships } from "../schema";
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

/**
 * Resolves which workspace a child belongs to before any tenant context exists, for requests
 * that name a child but no workspace. Runs in an identity transaction with `handoff.user_id`
 * set; the `children_identity_lookup` policy answers only for a caller with an active membership
 * in that child's workspace. Membership is not child permission: the service still checks the
 * grant after opening the tenant transaction.
 */
export async function findChildWorkspaceForMember(
  tx: HandoffTransaction,
  userId: string,
  childId: string,
): Promise<{ workspaceId: string } | null> {
  const [row] = await tx
    .select({ workspaceId: children.workspaceId })
    .from(children)
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, children.workspaceId),
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.status, "active"),
      ),
    )
    .where(eq(children.id, childId))
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

/**
 * Marks a child inaccessible. `authorizeChild` only accepts an `active` child, so this alone
 * removes it from every read path; the purge job then removes what it left behind. Returns null
 * when the child is already deleting or deleted, which is what makes a repeated request a no-op.
 */
export async function markChildDeleting(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string },
): Promise<ChildRow | null> {
  const [row] = await tx
    .update(children)
    .set({ status: "deleting", updatedAt: sql`now()`, version: sql`${children.version} + 1` })
    .where(
      and(
        eq(children.workspaceId, input.workspaceId),
        eq(children.id, input.childId),
        inArray(children.status, ["active", "archived"]),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * The terminal state of a purge. The row survives with an encrypted tombstone in place of its
 * profile, because retained redacted briefs and the audit log still point at this child.
 */
export async function markChildDeleted(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; profileCiphertext: unknown },
): Promise<ChildRow | null> {
  const [row] = await tx
    .update(children)
    .set({
      status: "deleted",
      profileCiphertext: input.profileCiphertext,
      updatedAt: sql`now()`,
      version: sql`${children.version} + 1`,
    })
    .where(and(eq(children.workspaceId, input.workspaceId), eq(children.id, input.childId)))
    .returning();
  return row ?? null;
}

/** Every child of a workspace whatever its status, which workspace deletion and rotation need. */
export async function listAllChildrenForWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
): Promise<ChildRow[]> {
  return tx
    .select()
    .from(children)
    .where(eq(children.workspaceId, workspaceId))
    .orderBy(children.createdAt, children.id);
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
