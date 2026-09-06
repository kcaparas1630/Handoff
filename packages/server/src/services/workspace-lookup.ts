// Resolves the workspace that owns a child, capture, event, or brief when the path carries only
// its id. A child resolves through the identity-scoped `children_identity_lookup` index policy.
// The remaining rows have no such index, so those lookups try the caller's own active workspaces
// in turn; row-level security answers for at most one of them.
import {
  capturesRepository,
  childrenRepository,
  handoffsRepository,
  identityRepository,
  invitationsRepository,
  withIdentityTransaction,
  withTenantTransaction,
} from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { findEventLocation } from "./journal-queries";
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

/**
 * Unknown and unauthorized children are the same 404, so a miss never confirms an id exists.
 * Membership is not child permission: every caller still authorizes the child inside its own
 * tenant transaction.
 */
export async function resolveChildWorkspace({
  deps,
  actorUserId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
}): Promise<string> {
  const found = await withIdentityTransaction(deps.db, { userId: actorUserId }, (tx) =>
    childrenRepository.findChildWorkspaceForMember(tx, actorUserId, childId),
  );
  if (found === null) throw ApiHttpError.notFound("That child is not available");
  return found.workspaceId;
}

export async function resolveCaptureWorkspace({
  deps,
  actorUserId,
  captureId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
}): Promise<string> {
  for (const workspaceId of await listCallerWorkspaceIds(deps, actorUserId)) {
    const found = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
      capturesRepository.findCaptureInWorkspace(tx, workspaceId, captureId),
    );
    if (found !== null) return workspaceId;
  }
  throw ApiHttpError.notFound("That recording is not available");
}

/** `/v1/events/:eventId` names neither a workspace nor a child; both come from the row. */
export async function resolveEventLocation({
  deps,
  actorUserId,
  eventId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  eventId: string;
}): Promise<{ workspaceId: string; childId: string }> {
  for (const workspaceId of await listCallerWorkspaceIds(deps, actorUserId)) {
    const found = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
      findEventLocation(tx, workspaceId, eventId),
    );
    if (found !== null) return found;
  }
  throw ApiHttpError.notFound("That entry is not available");
}

/** A brief belongs to one recipient, so another user's id simply finds nothing anywhere. */
export async function resolveBriefWorkspace({
  deps,
  actorUserId,
  briefId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  briefId: string;
}): Promise<string> {
  for (const workspaceId of await listCallerWorkspaceIds(deps, actorUserId)) {
    const found = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
      handoffsRepository.findBriefForRecipient(tx, workspaceId, briefId, actorUserId),
    );
    if (found !== null) return workspaceId;
  }
  throw ApiHttpError.notFound("That handoff is not available");
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
