// Membership freshness, revocation, and the workspace roster.
import {
  childrenRepository,
  identityRepository,
  infrastructureRepository,
  withTenantTransaction,
} from "@handoff/db";
import type { HandoffTransaction, WorkspaceMembershipRow } from "@handoff/db";
import type { WorkspaceMemberDto } from "@handoff/contracts";
import { authorizeWorkspace } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { mapClerkRoleToAppRole } from "../lib/map-clerk-role";
import { decryptUserProfile } from "../security/profile-fields";
import { canManageAnyChild, resolveManagerScope } from "./grant-scope";
import type { ServiceDeps } from "../types/runtime";

/** Architecture §3 target: local membership may be at most 60 seconds old for these operations. */
const MAX_LOCAL_VERIFICATION_AGE_MS = 60_000;

/**
 * Re-verifies a stale membership with Clerk for bootstrap, invitation, and admin operations.
 * If the provider no longer reports the membership, access is denied rather than served stale.
 */
export async function ensureFreshMembership({
  deps,
  tx,
  membership,
  clerkOrgId,
}: {
  deps: ServiceDeps;
  tx: HandoffTransaction;
  membership: WorkspaceMembershipRow;
  clerkOrgId: string;
}): Promise<WorkspaceMembershipRow> {
  const ageMs = deps.now().getTime() - membership.providerVerifiedAt.getTime();
  if (ageMs <= MAX_LOCAL_VERIFICATION_AGE_MS) return membership;

  const user = await identityRepository.findUserById(tx, membership.userId);
  if (user === null) throw ApiHttpError.notFound("That workspace is not available");

  const current = await deps.clerk.getOrganizationMembership({
    clerkOrgId,
    clerkUserId: user.clerkUserId,
  });
  if (current === null) {
    await identityRepository.revokeMembership(tx, {
      workspaceId: membership.workspaceId,
      userId: membership.userId,
      expectedVersion: membership.version,
    });
    throw ApiHttpError.notFound("That workspace is not available");
  }

  return identityRepository.upsertMembership(tx, {
    workspaceId: membership.workspaceId,
    userId: membership.userId,
    clerkMembershipId: current.clerkMembershipId,
    appRole: mapClerkRoleToAppRole({
      clerkRole: current.role,
      intendedAppRole: membership.appRole,
      guardianRoleKey: deps.guardianRoleKey,
    }),
    status: "active",
    providerVerifiedAt: deps.now(),
  });
}

export async function revokeMember({
  deps,
  actorUserId,
  workspaceId,
  targetUserId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  targetUserId: string;
}): Promise<{ userId: string; status: "revoked" }> {
  const target = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const actor = await authorizeWorkspace(tx, {
      userId: actorUserId,
      workspaceId,
      freshness: { deps },
    });
    if (actor.membership.appRole !== "owner") {
      throw ApiHttpError.forbidden("Only a workspace owner can remove a member");
    }

    const members = await identityRepository.listMembershipsForWorkspace(tx, workspaceId);
    const membership = members.find(
      (row) => row.userId === targetUserId && row.status === "active",
    );
    if (membership === undefined) throw ApiHttpError.notFound("That member is not available");

    const activeOwners = members.filter(
      (row) => row.status === "active" && row.appRole === "owner",
    );
    if (membership.appRole === "owner" && activeOwners.length <= 1) {
      throw ApiHttpError.conflict("A workspace must keep at least one owner");
    }

    const revoked = await identityRepository.revokeMembership(tx, {
      workspaceId,
      userId: targetUserId,
      expectedVersion: membership.version,
    });
    if (revoked === null) throw ApiHttpError.conflict("That membership changed; try again");

    // Local access stops immediately; Clerk is updated afterwards and reconciled if it fails.
    const grantedChildren = await childrenRepository.listChildrenGrantedToUser(
      tx,
      workspaceId,
      targetUserId,
    );
    for (const child of grantedChildren) {
      await childrenRepository.revokeChildCaregiver(tx, {
        workspaceId,
        childId: child.id,
        userId: targetUserId,
      });
    }

    const user = await identityRepository.findUserById(tx, targetUserId);
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      actorUserId,
      action: "membership.revoked",
      entityType: "workspace_membership",
      entityId: targetUserId,
      requestId: deps.requestId,
    });
    return { clerkUserId: user?.clerkUserId ?? null, clerkOrgId: actor.workspace.clerkOrgId };
  });

  if (target.clerkUserId !== null) {
    try {
      await deps.clerk.removeOrganizationMember({
        clerkOrgId: target.clerkOrgId,
        clerkUserId: target.clerkUserId,
      });
    } catch {
      // Memberships have no reconcile_needed state, so the pending removal is recorded instead.
      await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
        infrastructureRepository.insertAuditLog(tx, {
          workspaceId,
          actorUserId,
          action: "membership.clerk_removal_pending",
          entityType: "workspace_membership",
          entityId: targetUserId,
          requestId: deps.requestId,
        }),
      );
    }
  }
  return { userId: targetUserId, status: "revoked" };
}

export async function listMembers({
  deps,
  actorUserId,
  workspaceId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
}): Promise<WorkspaceMemberDto[]> {
  const rows = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const actor = await authorizeWorkspace(tx, { userId: actorUserId, workspaceId });
    const scope = await resolveManagerScope(tx, {
      workspaceId,
      userId: actorUserId,
      appRole: actor.membership.appRole,
    });
    // Roster privacy: a guardian or plain caregiver never sees the workspace member list.
    if (!canManageAnyChild(scope)) {
      throw ApiHttpError.forbidden("You cannot view this workspace's members");
    }
    const members = await identityRepository.listMembershipsForWorkspace(tx, workspaceId);
    return Promise.all(
      members.map(async (membership) => ({
        membership,
        user: await identityRepository.findUserById(tx, membership.userId),
      })),
    );
  });

  return Promise.all(
    rows.map(async ({ membership, user }) => ({
      userId: membership.userId,
      displayName:
        user === null ? null : await decryptUserProfile(deps.keys, user.id, user.profileCiphertext),
      appRole: membership.appRole,
      status: membership.status,
      version: membership.version,
    })),
  );
}
