// Every authorized request resolves (user, workspace, child permission) before anything else.
// Unknown and forbidden resources are indistinguishable 404s (data contract §8).
import { childrenRepository, identityRepository } from "@handoff/db";
import { resolveEffectiveChildPermission } from "@handoff/domain";
import type { HandoffTransaction } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { ensureFreshMembership } from "../services/memberships";
import type {
  ChildAuthorization,
  ProviderFreshness,
  WorkspaceAuthorization,
} from "../types/authorization";

export async function authorizeWorkspace(
  tx: HandoffTransaction,
  input: { userId: string; workspaceId: string; freshness?: ProviderFreshness },
): Promise<WorkspaceAuthorization> {
  // Runs inside the tenant transaction, so row-level security has already narrowed the rows.
  const memberships = await identityRepository.listActiveMembershipsForUser(tx, input.userId);
  const found = memberships.find((row) => row.membership.workspaceId === input.workspaceId);
  if (found === undefined || found.workspace.status !== "active") {
    throw ApiHttpError.notFound("That workspace is not available");
  }
  if (input.freshness === undefined) return found;

  const membership = await ensureFreshMembership({
    deps: input.freshness.deps,
    tx,
    membership: found.membership,
    clerkOrgId: found.workspace.clerkOrgId,
  });
  return { membership, workspace: found.workspace };
}

export async function authorizeChild(
  tx: HandoffTransaction,
  input: {
    userId: string;
    workspaceId: string;
    childId: string;
    freshness?: ProviderFreshness;
  },
): Promise<ChildAuthorization> {
  const { membership, workspace } = await authorizeWorkspace(tx, input);
  const child = await childrenRepository.findChildInWorkspace(tx, input.workspaceId, input.childId);
  if (child === null || child.status !== "active") {
    throw ApiHttpError.notFound("That child is not available");
  }
  const grant = await childrenRepository.findChildCaregiver(
    tx,
    input.workspaceId,
    input.childId,
    input.userId,
  );
  // Owners need no grant; a guardian's grant is capped at reader by the domain rule.
  const permission = resolveEffectiveChildPermission({
    appRole: membership.appRole,
    membershipStatus: membership.status,
    grant: grant === null ? null : { permission: grant.permission, status: grant.status },
  });
  if (permission === null) throw ApiHttpError.notFound("That child is not available");
  return { membership, workspace, child, permission };
}
