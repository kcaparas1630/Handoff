// Membership freshness, revocation, and the workspace roster.
import {
  careRepository,
  childrenRepository,
  identityRepository,
  infrastructureRepository,
  withTenantTransaction,
} from "@handoff/db";
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
 * The provider call happens between two short transactions rather than inside the caller's, so
 * no tenant transaction is ever held open across a network request (architecture §4). If the
 * provider no longer reports the membership, local access is revoked and the caller is denied.
 */
export async function refreshMembershipIfStale({
  deps,
  userId,
  workspaceId,
}: {
  deps: ServiceDeps;
  userId: string;
  workspaceId: string;
}): Promise<void> {
  const stale = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const memberships = await identityRepository.listActiveMembershipsForUser(tx, userId);
    const found = memberships.find((row) => row.membership.workspaceId === workspaceId);
    // A missing or inactive membership is the caller's own 404 to report, not this function's.
    if (found === undefined || found.workspace.status !== "active") return null;
    const ageMs = deps.now().getTime() - found.membership.providerVerifiedAt.getTime();
    if (ageMs <= MAX_LOCAL_VERIFICATION_AGE_MS) return null;
    const user = await identityRepository.findUserById(tx, found.membership.userId);
    if (user === null) return null;
    return {
      membership: found.membership,
      clerkOrgId: found.workspace.clerkOrgId,
      clerkUserId: user.clerkUserId,
    };
  });
  if (stale === null) return;

  const current = await deps.clerk.getOrganizationMembership({
    clerkOrgId: stale.clerkOrgId,
    clerkUserId: stale.clerkUserId,
  });

  await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    if (current === null) {
      await identityRepository.revokeMembership(tx, {
        workspaceId,
        userId,
        expectedVersion: stale.membership.version,
      });
      return;
    }
    await identityRepository.upsertMembership(tx, {
      workspaceId,
      userId,
      clerkMembershipId: current.clerkMembershipId,
      appRole: mapClerkRoleToAppRole({
        clerkRole: current.role,
        intendedAppRole: stale.membership.appRole,
        guardianRoleKey: deps.guardianRoleKey,
      }),
      status: "active",
      providerVerifiedAt: deps.now(),
    });
  });
  if (current === null) throw ApiHttpError.notFound("That workspace is not available");
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
  await refreshMembershipIfStale({ deps, userId: actorUserId, workspaceId });

  const target = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const actor = await authorizeWorkspace(tx, { userId: actorUserId, workspaceId });
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

    // Revocation closes that member's declared care, and nobody else's (data contract §4).
    await careRepository.endAllSessionsForUserInWorkspace(tx, {
      workspaceId,
      userId: targetUserId,
      endReason: "membership_revoked",
    });

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
