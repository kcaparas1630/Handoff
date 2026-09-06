// Workspace initialization. The organization is created in Clerk first; this materializes the
// local tenant and its owner after verifying live admin membership.
import { randomUUID } from "node:crypto";
import {
  identityRepository,
  infrastructureRepository,
  withIdentityTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { CreateWorkspaceRequest, WorkspaceDto } from "@handoff/contracts";
import type { WorkspaceRow } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { isClerkOrgAdmin } from "../lib/map-clerk-role";
import { createTransactionDataKeyService } from "../security/transaction-data-keys";
import { decryptWorkspaceProfile, encryptWorkspaceProfile } from "../security/profile-fields";
import type { ClerkMembership } from "../types/clerk";
import type { ServiceDeps } from "../types/runtime";

/** Prototype default; media budgets are enforced from milestone 4. */
const DEFAULT_STORAGE_BUDGET_BYTES = 1024 * 1024 * 1024;

/** Replaced inside the same transaction; see the note in services/bootstrap.ts. */
const PROFILE_PLACEHOLDER = { pendingProfileWrite: true };

/**
 * Hermes cannot enumerate time zones, so the shared contract only checks the name shape.
 * The real zone check belongs here, on the server.
 */
function assertKnownTimezone(timezone: string): void {
  const zones = Intl.supportedValuesOf("timeZone");
  if (timezone === "UTC" || zones.includes(timezone)) return;
  throw ApiHttpError.validationFailed("That time zone is not recognized", {
    timezone: ["Expected a known IANA time zone name"],
  });
}

async function verifyOrganizationAdmin(
  deps: ServiceDeps,
  clerkOrgId: string,
  clerkUserId: string,
): Promise<ClerkMembership> {
  const membership = await deps.clerk.getOrganizationMembership({ clerkOrgId, clerkUserId });
  if (membership === null || !isClerkOrgAdmin(membership.role)) {
    throw ApiHttpError.forbidden("You are not an administrator of that organization");
  }
  return membership;
}

export async function initializeWorkspace({
  deps,
  userId,
  clerkUserId,
  input,
}: {
  deps: ServiceDeps;
  userId: string;
  clerkUserId: string;
  input: CreateWorkspaceRequest;
}): Promise<WorkspaceDto> {
  const membership = await verifyOrganizationAdmin(deps, input.clerkOrgId, clerkUserId);
  assertKnownTimezone(input.timezone);

  const existing = await withIdentityTransaction(
    deps.db,
    { userId, clerkOrgId: input.clerkOrgId },
    (tx) => identityRepository.findWorkspaceByClerkOrgId(tx, input.clerkOrgId),
  );

  const workspace =
    existing === null
      ? await createWorkspace({ deps, userId, membership, input })
      : await adoptExistingWorkspace({ deps, userId, membership, workspace: existing });

  return {
    id: workspace.id,
    clerkOrgId: workspace.clerkOrgId,
    kind: workspace.kind,
    name: await decryptWorkspaceProfile(deps.keys, workspace.id, workspace.profileCiphertext),
    timezone: workspace.timezone,
    appRole: "owner",
    version: workspace.version,
  };
}

/** Retrying initialization returns the same workspace and never reaches another tenant. */
async function adoptExistingWorkspace({
  deps,
  userId,
  membership,
  workspace,
}: {
  deps: ServiceDeps;
  userId: string;
  membership: ClerkMembership;
  workspace: WorkspaceRow;
}): Promise<WorkspaceRow> {
  if (workspace.status !== "active") throw ApiHttpError.notFound("That workspace is not available");
  await withTenantTransaction(deps.db, { workspaceId: workspace.id }, (tx) =>
    identityRepository.upsertMembership(tx, {
      workspaceId: workspace.id,
      userId,
      clerkMembershipId: membership.clerkMembershipId,
      appRole: "owner",
      status: "active",
      providerVerifiedAt: deps.now(),
    }),
  );
  return workspace;
}

async function createWorkspace({
  deps,
  userId,
  membership,
  input,
}: {
  deps: ServiceDeps;
  userId: string;
  membership: ClerkMembership;
  input: CreateWorkspaceRequest;
}): Promise<WorkspaceRow> {
  const workspaceId = randomUUID();
  return withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    // A concurrent initialization of the same organization loses on the clerk_org_id unique
    // index and is retried by the client, which then takes the adopt path above.
    await identityRepository.insertWorkspace(tx, {
      id: workspaceId,
      clerkOrgId: input.clerkOrgId,
      kind: input.kind,
      profileCiphertext: PROFILE_PLACEHOLDER,
      timezone: input.timezone,
      storageBudgetBytes: DEFAULT_STORAGE_BUDGET_BYTES,
    });
    const keys = createTransactionDataKeyService(tx, deps.keyWrapper);
    const profileCiphertext = await encryptWorkspaceProfile(keys, workspaceId, input.name);
    const stored = await identityRepository.updateWorkspaceProfile(tx, {
      workspaceId,
      profileCiphertext,
    });
    if (stored === null) throw new Error("the new workspace row disappeared during initialization");

    await identityRepository.upsertMembership(tx, {
      workspaceId,
      userId,
      clerkMembershipId: membership.clerkMembershipId,
      appRole: "owner",
      status: "active",
      providerVerifiedAt: deps.now(),
    });
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      actorUserId: userId,
      action: "workspace.initialized",
      entityType: "workspace",
      entityId: workspaceId,
      requestId: deps.requestId,
    });
    return stored;
  });
}
