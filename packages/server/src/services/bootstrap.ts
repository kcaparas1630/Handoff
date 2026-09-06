// Reconciles a verified Clerk subject into the local projection after sign-in.
// This is the only place a local user row is created.
import {
  identityRepository,
  invitationsRepository,
  setIdentityContext,
  withIdentityTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { BootstrapResponse, WorkspaceDto } from "@handoff/contracts";
import type { UserRow } from "@handoff/db";
import { mapClerkRoleToAppRole } from "../lib/map-clerk-role";
import { workspaceScope } from "../lib/record-contexts";
import { computeInvitationLookupHash } from "../security/encryption/lib/invitation-lookup";
import { createTransactionDataKeyService } from "../security/transaction-data-keys";
import {
  decryptUserProfile,
  decryptWorkspaceProfile,
  encryptUserProfile,
} from "../security/profile-fields";
import { applyAcceptedInvitation } from "./invitation-acceptance";
import type { ClerkMembership } from "../types/clerk";
import type { ServiceDeps } from "../types/runtime";

/** One bootstrap call reconciles at most this many organizations. */
const MAX_RECONCILED_ORGS = 20;

/**
 * Replaced inside the same transaction once the row id is known. `data_keys` references
 * `users(id)`, so the user-scoped key cannot exist before the row does; nothing partial commits.
 */
const PROFILE_PLACEHOLDER = { pendingProfileWrite: true };

async function upsertLocalUser(
  deps: ServiceDeps,
  clerkUserId: string,
  displayName: string | null,
): Promise<UserRow> {
  return withIdentityTransaction(deps.db, {}, async (tx) => {
    const existing = await identityRepository.findUserByClerkId(tx, clerkUserId);
    if (existing !== null) return existing;

    const inserted = await identityRepository.upsertUserByClerkId(tx, {
      clerkUserId,
      profileCiphertext: PROFILE_PLACEHOLDER,
    });
    const keys = createTransactionDataKeyService(tx, deps.keyWrapper);
    const profileCiphertext = await encryptUserProfile(keys, inserted.id, displayName);
    const stored = await identityRepository.updateUserProfile(tx, {
      userId: inserted.id,
      profileCiphertext,
    });
    if (stored === null) throw new Error("the new user row disappeared during bootstrap");
    return stored;
  });
}

/** Maps verified Clerk organizations to local workspaces the caller may join. */
async function resolveWorkspaceIds(
  deps: ServiceDeps,
  userId: string,
  memberships: ClerkMembership[],
): Promise<Map<string, string>> {
  return withIdentityTransaction(deps.db, { userId }, async (tx) => {
    const byOrgId = new Map<string, string>();
    for (const membership of memberships) {
      await setIdentityContext(tx, { clerkOrgId: membership.clerkOrgId });
      const workspace = await identityRepository.findWorkspaceByClerkOrgId(
        tx,
        membership.clerkOrgId,
      );
      if (workspace !== null && workspace.status === "active") {
        byOrgId.set(membership.clerkOrgId, workspace.id);
      }
    }
    return byOrgId;
  });
}

async function reconcileWorkspace({
  deps,
  userId,
  workspaceId,
  membership,
  primaryEmail,
}: {
  deps: ServiceDeps;
  userId: string;
  workspaceId: string;
  membership: ClerkMembership;
  primaryEmail: string | null;
}): Promise<void> {
  const lookupHash =
    primaryEmail === null
      ? null
      : computeInvitationLookupHash({
          lookupKey: (await deps.keys.getLookupKey(workspaceScope(workspaceId))).key,
          workspaceId,
          email: primaryEmail,
        });

  await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const existing = await identityRepository.listActiveMembershipsForUser(tx, userId);
    const local = existing.find((row) => row.membership.workspaceId === workspaceId);
    await identityRepository.upsertMembership(tx, {
      workspaceId,
      userId,
      clerkMembershipId: membership.clerkMembershipId,
      appRole: mapClerkRoleToAppRole({
        clerkRole: membership.role,
        intendedAppRole: local?.membership.appRole ?? null,
        guardianRoleKey: deps.guardianRoleKey,
      }),
      status: "active",
      providerVerifiedAt: deps.now(),
    });

    if (lookupHash === null) return;
    // A hash match only selects the candidate intent; applyAcceptedInvitation re-verifies it.
    const intent = await invitationsRepository.findPendingInvitationByLookupHash(
      tx,
      workspaceId,
      lookupHash,
    );
    if (intent === null) return;
    await applyAcceptedInvitation({
      tx,
      deps,
      workspaceId,
      intentId: intent.id,
      acceptedUserId: userId,
      acceptedPrimaryEmail: primaryEmail,
      membership,
    });
  });
}

export async function bootstrap({
  deps,
  clerkUserId,
  displayName,
}: {
  deps: ServiceDeps;
  clerkUserId: string;
  displayName?: string | null;
}): Promise<BootstrapResponse> {
  // Live provider state first: a request never establishes membership on its own.
  const clerkMemberships = (await deps.clerk.listUserOrganizationMemberships(clerkUserId)).slice(
    0,
    MAX_RECONCILED_ORGS,
  );
  const user = await upsertLocalUser(deps, clerkUserId, displayName ?? null);
  const primaryEmail =
    clerkMemberships.length === 0 ? null : await deps.clerk.getUserPrimaryEmail(clerkUserId);

  const workspaceIds = await resolveWorkspaceIds(deps, user.id, clerkMemberships);
  for (const membership of clerkMemberships) {
    const workspaceId = workspaceIds.get(membership.clerkOrgId);
    if (workspaceId === undefined) continue;
    await reconcileWorkspace({ deps, userId: user.id, workspaceId, membership, primaryEmail });
  }

  const memberships = await withIdentityTransaction(deps.db, { userId: user.id }, (tx) =>
    identityRepository.listActiveMembershipsForUser(tx, user.id),
  );
  const workspaces: WorkspaceDto[] = await Promise.all(
    memberships
      .filter((row) => row.workspace.status === "active")
      .map(async (row) => ({
        id: row.workspace.id,
        clerkOrgId: row.workspace.clerkOrgId,
        kind: row.workspace.kind,
        name: await decryptWorkspaceProfile(
          deps.keys,
          row.workspace.id,
          row.workspace.profileCiphertext,
        ),
        timezone: row.workspace.timezone,
        appRole: row.membership.appRole,
        version: row.workspace.version,
      })),
  );

  return {
    user: {
      id: user.id,
      clerkUserId: user.clerkUserId,
      // The caller is this subject, so their own profile is the always-permitted decrypt.
      displayName: await decryptUserProfile(deps.keys, user.id, user.profileCiphertext),
      processingNoticeVersion: user.processingNoticeVersion,
    },
    workspaces,
  };
}
