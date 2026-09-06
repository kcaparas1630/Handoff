// Invitation intents: persisted locally first, then sent through Clerk and reconciled.
import { randomUUID } from "node:crypto";
import {
  childrenRepository,
  infrastructureRepository,
  invitationsRepository,
  withTenantTransaction,
} from "@handoff/db";
import { inviteeEmailSchema } from "@handoff/contracts";
import type {
  CreateInvitationRequest,
  InvitationDetailDto,
  InvitationDto,
} from "@handoff/contracts";
import type { InvitationIntentRow } from "@handoff/db";
import { authorizeWorkspace } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { toInvitationDto } from "../lib/invitation-dto";
import { mapAppRoleToClerkRole } from "../lib/map-clerk-role";
import { workspaceScope } from "../lib/record-contexts";
import { computeInvitationLookupHash } from "../security/encryption/lib/invitation-lookup";
import { decryptInviteeEmail, encryptInviteeEmail } from "../security/profile-fields";
import { canManageAnyChild, managesChild, resolveManagerScope } from "./grant-scope";
import { authorizeInvitationAccess } from "./invitation-access";
import { refreshMembershipIfStale } from "./memberships";
import type { ServiceDeps } from "../types/runtime";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation({
  deps,
  actorUserId,
  workspaceId,
  input,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  input: CreateInvitationRequest;
}): Promise<InvitationDto> {
  const email = inviteeEmailSchema.parse(input.email);
  // A guardian is read-only by app-role ceiling, so an elevated grant would be silently ignored.
  if (
    input.intendedAppRole === "guardian" &&
    input.childGrants.some((grant) => grant.permission !== "reader")
  ) {
    throw ApiHttpError.validationFailed("A guardian invitation can only grant read access", {
      childGrants: ["A guardian may only be granted reader permission"],
    });
  }

  await refreshMembershipIfStale({ deps, userId: actorUserId, workspaceId });

  const clerkOrgId = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const actor = await authorizeWorkspace(tx, { userId: actorUserId, workspaceId });
    const scope = await resolveManagerScope(tx, {
      workspaceId,
      userId: actorUserId,
      appRole: actor.membership.appRole,
    });
    if (!canManageAnyChild(scope)) {
      throw ApiHttpError.forbidden("You cannot invite people to this workspace");
    }
    if (input.intendedAppRole === "owner" && actor.membership.appRole !== "owner") {
      throw ApiHttpError.forbidden("Only an owner can invite another owner");
    }
    for (const grant of input.childGrants) {
      const child = await childrenRepository.findChildInWorkspace(tx, workspaceId, grant.childId);
      if (child === null || child.status !== "active" || !managesChild(scope, grant.childId)) {
        throw ApiHttpError.notFound("That child is not available");
      }
    }
    return actor.workspace.clerkOrgId;
  });

  const lookupKey = await deps.keys.getLookupKey(workspaceScope(workspaceId));
  const emailLookupHash = computeInvitationLookupHash({
    lookupKey: lookupKey.key,
    workspaceId,
    email,
  });
  const invitationId = randomUUID();
  const inviteeCiphertext = await encryptInviteeEmail(deps.keys, {
    workspaceId,
    invitationId,
    email,
  });

  const created = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    // An open intent for the same address is returned instead of a duplicate; the partial unique
    // index on (workspace_id, email_lookup_hash) rejects a concurrent second insert.
    const existing = await invitationsRepository.findPendingInvitationByLookupHash(
      tx,
      workspaceId,
      emailLookupHash,
    );
    if (existing !== null) {
      const grants = await invitationsRepository.listInvitationChildGrants(
        tx,
        workspaceId,
        existing.id,
      );
      return { intent: existing, grants, isNew: false };
    }
    const intent = await invitationsRepository.insertInvitationIntent(tx, {
      id: invitationId,
      workspaceId,
      inviteeCiphertext,
      emailLookupHash,
      emailLookupKeyId: lookupKey.keyId,
      intendedAppRole: input.intendedAppRole,
      invitedByUserId: actorUserId,
      expiresAt: new Date(deps.now().getTime() + INVITATION_TTL_MS),
    });
    const grants = await invitationsRepository.insertInvitationChildGrants(
      tx,
      input.childGrants.map((grant) => ({
        workspaceId,
        invitationIntentId: invitationId,
        childId: grant.childId,
        relationship: grant.relationship,
        permission: grant.permission,
      })),
    );
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      actorUserId,
      action: "invitation.created",
      entityType: "invitation_intent",
      entityId: invitationId,
      requestId: deps.requestId,
    });
    return { intent, grants, isNew: true };
  });

  if (!created.isNew) return toInvitationDto(created.intent, created.grants);

  const sent = await sendInvitation({
    deps,
    workspaceId,
    clerkOrgId,
    intent: created.intent,
    email,
  });
  return toInvitationDto(sent, created.grants);
}

/** Clerk and Postgres cannot share a transaction, so the send result is persisted afterwards. */
async function sendInvitation({
  deps,
  workspaceId,
  clerkOrgId,
  intent,
  email,
}: {
  deps: ServiceDeps;
  workspaceId: string;
  clerkOrgId: string;
  intent: InvitationIntentRow;
  email: string;
}): Promise<InvitationIntentRow> {
  let clerkInvitationId: string | null = null;
  try {
    const result = await deps.clerk.createOrganizationInvitation({
      clerkOrgId,
      email,
      role: mapAppRoleToClerkRole({
        appRole: intent.intendedAppRole,
        guardianRoleKey: deps.guardianRoleKey,
      }),
      redirectUrl: deps.invitationRedirectUrl,
      publicMetadata: { intentId: intent.id },
    });
    clerkInvitationId = result.clerkInvitationId;
  } catch {
    // An ambiguous send never reports success; reconciliation resolves it.
    clerkInvitationId = null;
  }

  const updated = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
    invitationsRepository.updateInvitationStatus(tx, {
      workspaceId,
      invitationId: intent.id,
      expectedVersion: intent.version,
      status: clerkInvitationId === null ? "reconcile_needed" : "sent",
      ...(clerkInvitationId === null ? {} : { clerkInvitationId }),
    }),
  );
  if (updated === null) throw ApiHttpError.conflict("That invitation changed; try again");
  return updated;
}

export async function listInvitations({
  deps,
  actorUserId,
  workspaceId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
}): Promise<InvitationDto[]> {
  await authorizeInvitationAccess(deps, actorUserId, workspaceId);
  return withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const intents = await invitationsRepository.listInvitationsForWorkspace(tx, workspaceId);
    return Promise.all(
      intents.map(async (intent) =>
        toInvitationDto(
          intent,
          await invitationsRepository.listInvitationChildGrants(tx, workspaceId, intent.id),
        ),
      ),
    );
  });
}

export async function getInvitation({
  deps,
  actorUserId,
  workspaceId,
  invitationId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  invitationId: string;
}): Promise<InvitationDetailDto> {
  await authorizeInvitationAccess(deps, actorUserId, workspaceId);
  const found = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const intent = await invitationsRepository.findInvitationById(tx, workspaceId, invitationId);
    if (intent === null) throw ApiHttpError.notFound("That invitation is not available");
    return {
      intent,
      grants: await invitationsRepository.listInvitationChildGrants(tx, workspaceId, invitationId),
    };
  });
  // Authorized above; the address is decrypted only for this owner/manager detail read.
  const inviteeEmail = await decryptInviteeEmail(deps.keys, {
    workspaceId,
    invitationId,
    envelope: found.intent.inviteeCiphertext,
  });
  return { ...toInvitationDto(found.intent, found.grants), inviteeEmail };
}

export async function revokeInvitation({
  deps,
  actorUserId,
  workspaceId,
  invitationId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
  invitationId: string;
}): Promise<InvitationDto> {
  const clerkOrgId = await authorizeInvitationAccess(deps, actorUserId, workspaceId);

  const revoked = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const intent = await invitationsRepository.findInvitationById(tx, workspaceId, invitationId);
    if (intent === null) throw ApiHttpError.notFound("That invitation is not available");
    const grants = await invitationsRepository.listInvitationChildGrants(
      tx,
      workspaceId,
      invitationId,
    );
    if (intent.status === "revoked") return { intent, grants, clerkInvitationId: null };

    const updated = await invitationsRepository.updateInvitationStatus(tx, {
      workspaceId,
      invitationId,
      expectedVersion: intent.version,
      status: "revoked",
    });
    if (updated === null) throw ApiHttpError.conflict("That invitation changed; try again");
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      actorUserId,
      action: "invitation.revoked",
      entityType: "invitation_intent",
      entityId: invitationId,
      requestId: deps.requestId,
    });
    return { intent: updated, grants, clerkInvitationId: intent.clerkInvitationId };
  });

  if (revoked.clerkInvitationId !== null) {
    try {
      await deps.clerk.revokeOrganizationInvitation({
        clerkOrgId,
        clerkInvitationId: revoked.clerkInvitationId,
      });
    } catch {
      // The local status stays revoked so an old provider link can never grant access; only the
      // pending provider revocation is recorded, for bounded reconciliation.
      await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
        infrastructureRepository.insertAuditLog(tx, {
          workspaceId,
          actorUserId,
          action: "invitation.clerk_revocation_pending",
          entityType: "invitation_intent",
          entityId: invitationId,
          requestId: deps.requestId,
        }),
      );
    }
  }
  return toInvitationDto(revoked.intent, revoked.grants);
}
