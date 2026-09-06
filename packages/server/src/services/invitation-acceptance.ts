// Applying a stored invitation intent after a verified Clerk acceptance.
// An intent id in public metadata is not evidence: the recipient identity is checked here.
import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  childrenRepository,
  identityRepository,
  infrastructureRepository,
  invitationsRepository,
} from "@handoff/db";
import type { HandoffTransaction } from "@handoff/db";
import { computeInvitationLookupHash } from "../security/encryption/lib/invitation-lookup";
import { mapClerkRoleToAppRole } from "../lib/map-clerk-role";
import { workspaceScope } from "../lib/record-contexts";
import type { ClerkMembership } from "../types/clerk";
import type { ServiceDeps } from "../types/runtime";

export type InvitationApplication =
  | { applied: true }
  | {
      applied: false;
      reason:
        | "missing"
        | "already_accepted"
        | "not_open"
        | "expired"
        | "wrong_recipient"
        | "no_membership";
    };

const OPEN_STATUSES = new Set(["sent", "reconcile_needed"]);

function hashesMatch(left: Uint8Array, right: Uint8Array): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Idempotent: an already-accepted intent returns without new effects, so repeated webhook
 * deliveries and a bootstrap running alongside them produce one membership and one grant set.
 */
export async function applyAcceptedInvitation({
  tx,
  deps,
  workspaceId,
  intentId,
  acceptedUserId,
  acceptedPrimaryEmail,
  membership,
}: {
  tx: HandoffTransaction;
  deps: ServiceDeps;
  workspaceId: string;
  intentId: string;
  acceptedUserId: string;
  /** Primary email read from Clerk for the accepting subject, never from the request. */
  acceptedPrimaryEmail: string | null;
  /** Current provider membership, freshly fetched before this call. */
  membership: ClerkMembership | null;
}): Promise<InvitationApplication> {
  const intent = await invitationsRepository.findInvitationById(tx, workspaceId, intentId);
  if (intent === null) return { applied: false, reason: "missing" };
  if (intent.status === "accepted") return { applied: false, reason: "already_accepted" };
  if (!OPEN_STATUSES.has(intent.status)) return { applied: false, reason: "not_open" };

  if (intent.expiresAt.getTime() <= deps.now().getTime()) {
    await invitationsRepository.updateInvitationStatus(tx, {
      workspaceId,
      invitationId: intentId,
      expectedVersion: intent.version,
      status: "expired",
    });
    return { applied: false, reason: "expired" };
  }
  if (membership === null) return { applied: false, reason: "no_membership" };

  if (acceptedPrimaryEmail === null) return { applied: false, reason: "wrong_recipient" };
  // The stored key id is used rather than the active one so rotation cannot break verification.
  const lookupKey = await deps.keys.getDecryptionKey(
    intent.emailLookupKeyId,
    workspaceScope(workspaceId),
  );
  const candidateHash = computeInvitationLookupHash({
    lookupKey,
    workspaceId,
    email: acceptedPrimaryEmail,
  });
  if (!hashesMatch(candidateHash, intent.emailLookupHash)) {
    return { applied: false, reason: "wrong_recipient" };
  }

  await identityRepository.upsertMembership(tx, {
    workspaceId,
    userId: acceptedUserId,
    clerkMembershipId: membership.clerkMembershipId,
    appRole: mapClerkRoleToAppRole({
      clerkRole: membership.role,
      intendedAppRole: intent.intendedAppRole,
      guardianRoleKey: deps.guardianRoleKey,
    }),
    status: "active",
    providerVerifiedAt: deps.now(),
  });

  const grants = await invitationsRepository.listInvitationChildGrants(tx, workspaceId, intentId);
  for (const grant of grants) {
    await childrenRepository.upsertChildCaregiver(tx, {
      workspaceId,
      childId: grant.childId,
      userId: acceptedUserId,
      relationship: grant.relationship,
      permission: grant.permission,
      grantedByUserId: intent.invitedByUserId,
    });
  }

  await invitationsRepository.updateInvitationStatus(tx, {
    workspaceId,
    invitationId: intentId,
    expectedVersion: intent.version,
    status: "accepted",
    acceptedByUserId: acceptedUserId,
    acceptedAt: deps.now(),
  });
  await infrastructureRepository.insertAuditLog(tx, {
    workspaceId,
    actorUserId: acceptedUserId,
    action: "invitation.accepted",
    entityType: "invitation_intent",
    entityId: intentId,
    requestId: deps.requestId,
  });
  return { applied: true };
}
