// Shared authorization for every invitation operation in a workspace.
import { withTenantTransaction } from "@handoff/db";
import { authorizeWorkspace } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { canManageAnyChild, resolveManagerScope } from "./grant-scope";
import { refreshMembershipIfStale } from "./memberships";
import type { ServiceDeps } from "../types/runtime";

/**
 * Owners and managers only. Invitation management is an admin operation, so membership
 * freshness is re-established first. Returns the verified Clerk organization id.
 */
export async function authorizeInvitationAccess(
  deps: ServiceDeps,
  actorUserId: string,
  workspaceId: string,
): Promise<string> {
  await refreshMembershipIfStale({ deps, userId: actorUserId, workspaceId });

  return withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const actor = await authorizeWorkspace(tx, { userId: actorUserId, workspaceId });
    const scope = await resolveManagerScope(tx, {
      workspaceId,
      userId: actorUserId,
      appRole: actor.membership.appRole,
    });
    if (!canManageAnyChild(scope)) {
      throw ApiHttpError.forbidden("You cannot manage this workspace's invitations");
    }
    return actor.workspace.clerkOrgId;
  });
}
