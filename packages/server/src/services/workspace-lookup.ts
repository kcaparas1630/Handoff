// Resolves the workspace that owns a child or invitation when the path carries only its id.
// Children, grants, and invitations are unreadable without tenant context, so milestone 1 tries
// the caller's own active workspaces in turn. A `child_id → workspace_id` identity-scoped index
// lookup replaces this in milestone 2, before the request volume makes the fan-out matter.
import {
  identityRepository,
  invitationsRepository,
  withIdentityTransaction,
  withTenantTransaction,
} from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import type { ServiceDeps } from "../types/runtime";

/** A caller with more workspaces than this cannot reach the rest through an id-only path. */
const MAX_SEARCHED_WORKSPACES = 20;

async function listCallerWorkspaceIds(deps: ServiceDeps, actorUserId: string): Promise<string[]> {
  const memberships = await withIdentityTransaction(deps.db, { userId: actorUserId }, (tx) =>
    identityRepository.listActiveMembershipsForUser(tx, actorUserId),
  );
  return memberships
    .filter((row) => row.workspace.status === "active")
    .slice(0, MAX_SEARCHED_WORKSPACES)
    .map((row) => row.workspace.id);
}

/** Unknown and unauthorized children are the same 404, so a miss never confirms an id exists. */
export async function resolveChildWorkspace({
  deps,
  actorUserId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
}): Promise<string> {
  for (const workspaceId of await listCallerWorkspaceIds(deps, actorUserId)) {
    const authorized = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
      try {
        await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
        return true;
      } catch (error) {
        if (error instanceof ApiHttpError && error.status === 404) return false;
        throw error;
      }
    });
    if (authorized) return workspaceId;
  }
  throw ApiHttpError.notFound("That child is not available");
}

/**
 * Locates the invitation's workspace only. Whether the caller may read or revoke it is decided
 * by the invitation service, which re-verifies owner/manager scope with Clerk.
 */
export async function resolveInvitationWorkspace({
  deps,
  actorUserId,
  invitationId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  invitationId: string;
}): Promise<string> {
  for (const workspaceId of await listCallerWorkspaceIds(deps, actorUserId)) {
    const found = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
      invitationsRepository.findInvitationById(tx, workspaceId, invitationId),
    );
    if (found !== null) return workspaceId;
  }
  throw ApiHttpError.notFound("That invitation is not available");
}
