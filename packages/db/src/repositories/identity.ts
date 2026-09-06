import { and, eq, sql } from "drizzle-orm";
import { users, workspaceMemberships, workspaces } from "../schema";
import type {
  MembershipWithWorkspace,
  NewUser,
  NewWorkspace,
  UpsertMembership,
  UserRow,
  WorkspaceMembershipRow,
  WorkspaceRow,
} from "../types/identity";
import type { HandoffTransaction } from "../types/database";

/** Bootstrap entry point for a verified Clerk subject. Never updates an existing profile. */
export async function upsertUserByClerkId(
  tx: HandoffTransaction,
  input: NewUser,
): Promise<UserRow> {
  const [row] = await tx
    .insert(users)
    .values({ clerkUserId: input.clerkUserId, profileCiphertext: input.profileCiphertext })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error("upsertUserByClerkId returned no row");
  return row;
}

export async function findUserByClerkId(
  tx: HandoffTransaction,
  clerkUserId: string,
): Promise<UserRow | null> {
  const [row] = await tx.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
  return row ?? null;
}

export async function findWorkspaceByClerkOrgId(
  tx: HandoffTransaction,
  clerkOrgId: string,
): Promise<WorkspaceRow | null> {
  const [row] = await tx
    .select()
    .from(workspaces)
    .where(eq(workspaces.clerkOrgId, clerkOrgId))
    .limit(1);
  return row ?? null;
}

/** The caller allocates the workspace id so it can open the tenant transaction that inserts it. */
export async function insertWorkspace(
  tx: HandoffTransaction,
  input: NewWorkspace,
): Promise<WorkspaceRow> {
  const [row] = await tx.insert(workspaces).values(input).returning();
  if (!row) throw new Error("insertWorkspace returned no row");
  return row;
}

export async function upsertMembership(
  tx: HandoffTransaction,
  input: UpsertMembership,
): Promise<WorkspaceMembershipRow> {
  const [row] = await tx
    .insert(workspaceMemberships)
    .values(input)
    .onConflictDoUpdate({
      target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      set: {
        clerkMembershipId: input.clerkMembershipId,
        appRole: input.appRole,
        status: input.status,
        providerVerifiedAt: input.providerVerifiedAt,
        revokedAt: input.status === "revoked" ? sql`now()` : null,
        updatedAt: sql`now()`,
        version: sql`${workspaceMemberships.version} + 1`,
      },
    })
    .returning();
  if (!row) throw new Error("upsertMembership returned no row");
  return row;
}

/** Cross-tenant read used by bootstrap; runs in an identity transaction, not a tenant one. */
export async function listActiveMembershipsForUser(
  tx: HandoffTransaction,
  userId: string,
): Promise<MembershipWithWorkspace[]> {
  return tx
    .select({ membership: workspaceMemberships, workspace: workspaces })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(and(eq(workspaceMemberships.userId, userId), eq(workspaceMemberships.status, "active")));
}

export async function revokeMembership(
  tx: HandoffTransaction,
  input: { workspaceId: string; userId: string; expectedVersion: number },
): Promise<WorkspaceMembershipRow | null> {
  const [row] = await tx
    .update(workspaceMemberships)
    .set({
      status: "revoked",
      revokedAt: sql`now()`,
      updatedAt: sql`now()`,
      version: sql`${workspaceMemberships.version} + 1`,
    })
    .where(
      and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.userId, input.userId),
        eq(workspaceMemberships.version, input.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}
