// Verified Clerk webhooks. Signature first, then durable deduplication, then reconciliation
// against current provider state. Inbox rows keep provider identifiers only.
import { z } from "zod";
import {
  careRepository,
  childrenRepository,
  identityRepository,
  infrastructureRepository,
  invitationsRepository,
  withIdentityTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { UserRow, WorkspaceRow } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { mapClerkRoleToAppRole } from "../lib/map-clerk-role";
import { encryptUserProfile } from "../security/profile-fields";
import { applyAcceptedInvitation } from "./invitation-acceptance";
import type { ServiceDeps } from "../types/runtime";

const PROVIDER = "clerk";

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/** Clerk carries only an opaque intent id; it is a lookup hint, never an authorization. */
const publicMetadataSchema = z.object({ intentId: z.uuid().optional() }).nullable();

function readIntentId(metadata: unknown): string | null {
  const parsed = publicMetadataSchema.safeParse(metadata);
  if (!parsed.success || parsed.data === null) return null;
  return parsed.data.intentId ?? null;
}

async function findLocalUser(deps: ServiceDeps, clerkUserId: string): Promise<UserRow | null> {
  return withIdentityTransaction(deps.db, {}, (tx) =>
    identityRepository.findUserByClerkId(tx, clerkUserId),
  );
}

async function findLocalWorkspace(
  deps: ServiceDeps,
  clerkOrgId: string,
): Promise<WorkspaceRow | null> {
  const workspace = await withIdentityTransaction(deps.db, { clerkOrgId }, (tx) =>
    identityRepository.findWorkspaceByClerkOrgId(tx, clerkOrgId),
  );
  return workspace === null || workspace.status !== "active" ? null : workspace;
}

async function revokeLocalMembership(
  deps: ServiceDeps,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const memberships = await identityRepository.listActiveMembershipsForUser(tx, userId);
    const current = memberships.find((row) => row.membership.workspaceId === workspaceId);
    if (current === undefined) return;
    await identityRepository.revokeMembership(tx, {
      workspaceId,
      userId,
      expectedVersion: current.membership.version,
    });
    const granted = await childrenRepository.listChildrenGrantedToUser(tx, workspaceId, userId);
    for (const child of granted) {
      await childrenRepository.revokeChildCaregiver(tx, { workspaceId, childId: child.id, userId });
    }
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      actorUserId: null,
      action: "membership.revoked_by_provider",
      entityType: "workspace_membership",
      entityId: userId,
      requestId: deps.requestId,
    });
  });
}

/** Applies the current provider membership, plus any intent whose recipient really matches. */
async function reconcileMembership({
  deps,
  clerkOrgId,
  clerkUserId,
  intentId,
}: {
  deps: ServiceDeps;
  clerkOrgId: string;
  clerkUserId: string;
  intentId: string | null;
}): Promise<WebhookOutcome> {
  const user = await findLocalUser(deps, clerkUserId);
  const workspace = await findLocalWorkspace(deps, clerkOrgId);
  if (user === null || workspace === null) return "ignored";

  // Architecture §3: fetch current membership state before applying a delayed event.
  const membership = await deps.clerk.getOrganizationMembership({ clerkOrgId, clerkUserId });
  if (membership === null) {
    await revokeLocalMembership(deps, workspace.id, user.id);
    return "processed";
  }
  const primaryEmail = intentId === null ? null : await deps.clerk.getUserPrimaryEmail(clerkUserId);

  await withTenantTransaction(deps.db, { workspaceId: workspace.id }, async (tx) => {
    const existing = await identityRepository.listActiveMembershipsForUser(tx, user.id);
    const local = existing.find((row) => row.membership.workspaceId === workspace.id);
    await identityRepository.upsertMembership(tx, {
      workspaceId: workspace.id,
      userId: user.id,
      clerkMembershipId: membership.clerkMembershipId,
      appRole: mapClerkRoleToAppRole({
        clerkRole: membership.role,
        intendedAppRole: local?.membership.appRole ?? null,
        guardianRoleKey: deps.guardianRoleKey,
      }),
      status: "active",
      providerVerifiedAt: deps.now(),
    });
    if (intentId === null) return;
    await applyAcceptedInvitation({
      tx,
      deps,
      workspaceId: workspace.id,
      intentId,
      acceptedUserId: user.id,
      acceptedPrimaryEmail: primaryEmail,
      membership,
    });
  });
  return "processed";
}

async function syncRevokedInvitation({
  deps,
  clerkOrgId,
  intentId,
}: {
  deps: ServiceDeps;
  clerkOrgId: string;
  intentId: string | null;
}): Promise<WebhookOutcome> {
  if (intentId === null) return "ignored";
  const workspace = await findLocalWorkspace(deps, clerkOrgId);
  if (workspace === null) return "ignored";
  await withTenantTransaction(deps.db, { workspaceId: workspace.id }, async (tx) => {
    const intent = await invitationsRepository.findInvitationById(tx, workspace.id, intentId);
    if (intent === null || intent.status === "accepted" || intent.status === "revoked") return;
    await invitationsRepository.updateInvitationStatus(tx, {
      workspaceId: workspace.id,
      invitationId: intentId,
      expectedVersion: intent.version,
      status: "revoked",
    });
  });
  return "processed";
}

/**
 * Account deletion at the provider. Records the caller authored stay: the data contract says
 * account deletion anonymizes attribution where records must be retained, so the row survives with
 * an encrypted empty display name and every workspace it reached loses access at once. Voice
 * recordings, drafts, and events belong to a workspace and are removed by its own deletion.
 */
async function applyUserDeleted(deps: ServiceDeps, clerkUserId: string): Promise<WebhookOutcome> {
  const user = await findLocalUser(deps, clerkUserId);
  if (user === null) return "ignored";
  // Encrypted before the transaction opens: a key fetch must not be held under a write lock.
  const profileCiphertext = await encryptUserProfile(deps.keys, user.id, null);
  const memberships = await withIdentityTransaction(deps.db, { userId: user.id }, async (tx) => {
    await identityRepository.markUserDeleted(tx, user.id);
    await identityRepository.updateUserProfile(tx, { userId: user.id, profileCiphertext });
    return identityRepository.listActiveMembershipsForUser(tx, user.id);
  });
  for (const row of memberships) {
    const workspaceId = row.membership.workspaceId;
    await revokeLocalMembership(deps, workspaceId, user.id);
    // Revocation closes that member's declared care, and nobody else's (data contract §4).
    await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
      await careRepository.endAllSessionsForUserInWorkspace(tx, {
        workspaceId,
        userId: user.id,
        endReason: "membership_revoked",
      });
      await infrastructureRepository.insertAuditLog(tx, {
        workspaceId,
        actorUserId: null,
        action: "user.anonymized",
        entityType: "user",
        entityId: user.id,
        requestId: deps.requestId,
      });
    });
  }
  return "processed";
}

export async function handleClerkWebhook({
  deps,
  request,
}: {
  deps: ServiceDeps;
  request: Request;
}): Promise<{ outcome: WebhookOutcome }> {
  const deliveryId = request.headers.get("svix-id");
  const event = await deps.clerk.verifyWebhook(request);
  if (deliveryId === null) {
    throw ApiHttpError.validationFailed("The webhook delivery has no svix-id header");
  }

  const inbox = describeEvent(event);
  const inserted = await withIdentityTransaction(deps.db, {}, (tx) =>
    infrastructureRepository.insertWebhookInboxIfAbsent(tx, {
      provider: PROVIDER,
      eventId: deliveryId,
      eventType: event.type,
      ...inbox,
    }),
  );
  if (!inserted) return { outcome: "duplicate" };

  const outcome = await dispatch(deps, event);
  await withIdentityTransaction(deps.db, {}, (tx) =>
    infrastructureRepository.markWebhookProcessed(tx, PROVIDER, deliveryId),
  );
  return { outcome };
}

type ClerkEvent = Awaited<ReturnType<ServiceDeps["clerk"]["verifyWebhook"]>>;

function describeEvent(event: ClerkEvent): {
  clerkOrgId?: string;
  clerkUserId?: string;
  clerkMembershipId?: string;
  clerkInvitationId?: string;
} {
  switch (event.type) {
    case "organizationMembership.created":
    case "organizationMembership.updated":
    case "organizationMembership.deleted":
      return {
        clerkOrgId: event.data.organization.id,
        clerkUserId: event.data.public_user_data.user_id,
        clerkMembershipId: event.data.id,
      };
    case "organizationInvitation.accepted":
      return {
        clerkOrgId: event.data.organization_id,
        clerkUserId: event.data.user_id,
        clerkInvitationId: event.data.id,
      };
    case "organizationInvitation.created":
    case "organizationInvitation.revoked":
      return { clerkOrgId: event.data.organization_id, clerkInvitationId: event.data.id };
    case "user.deleted":
      return event.data.id === undefined ? {} : { clerkUserId: event.data.id };
    default:
      return {};
  }
}

function dispatch(deps: ServiceDeps, event: ClerkEvent): Promise<WebhookOutcome> {
  switch (event.type) {
    case "organizationMembership.created":
    case "organizationMembership.updated":
      return reconcileMembership({
        deps,
        clerkOrgId: event.data.organization.id,
        clerkUserId: event.data.public_user_data.user_id,
        intentId: readIntentId(event.data.public_metadata),
      });
    case "organizationMembership.deleted":
      return revokeMembershipEvent(
        deps,
        event.data.organization.id,
        event.data.public_user_data.user_id,
      );
    case "organizationInvitation.accepted":
      return reconcileMembership({
        deps,
        clerkOrgId: event.data.organization_id,
        clerkUserId: event.data.user_id,
        intentId: readIntentId(event.data.public_metadata),
      });
    case "organizationInvitation.revoked":
      return syncRevokedInvitation({
        deps,
        clerkOrgId: event.data.organization_id,
        intentId: readIntentId(event.data.public_metadata),
      });
    case "user.deleted":
      return event.data.id === undefined
        ? Promise.resolve("ignored")
        : applyUserDeleted(deps, event.data.id);
    default:
      return Promise.resolve("ignored");
  }
}

async function revokeMembershipEvent(
  deps: ServiceDeps,
  clerkOrgId: string,
  clerkUserId: string,
): Promise<WebhookOutcome> {
  const user = await findLocalUser(deps, clerkUserId);
  const workspace = await findLocalWorkspace(deps, clerkOrgId);
  if (user === null || workspace === null) return "ignored";
  await revokeLocalMembership(deps, workspace.id, user.id);
  return "processed";
}
