// Bounded reconciliation of provider calls that failed after the local write already committed.
// Local access stopped immediately in both cases; this only catches Clerk up, and it records the
// outcome as an audit row rather than mutating anything the caregiver can see.
import {
  identityRepository,
  infrastructureRepository,
  invitationsRepository,
  jobsRepository,
  withIdentityTransaction,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import { z } from "zod";
import type { HandoffDatabase } from "@handoff/db";
import { ProviderError } from "../lib/provider-error";
import { reconcileClerkDedupeKey } from "../services/job-keys";
import type { ClerkGateway } from "../types/clerk";
import type { JobHandler } from "../types/jobs";

const PENDING_INVITATION_REVOCATION = "invitation.clerk_revocation_pending";
const PENDING_MEMBERSHIP_REMOVAL = "membership.clerk_removal_pending";

const PENDING_ACTIONS = [PENDING_INVITATION_REVOCATION, PENDING_MEMBERSHIP_REMOVAL];

/** Ids and an action name only; no email, name, or provider body is carried into the queue. */
const payloadSchema = z.object({
  auditLogId: z.uuid(),
  action: z.enum([PENDING_INVITATION_REVOCATION, PENDING_MEMBERSHIP_REMOVAL]),
  entityId: z.uuid(),
});

/**
 * One job per pending audit row, keyed by that row's id so the same failure is never scheduled
 * twice and a later failure for the same entity still gets its own job.
 */
export async function scheduleReconciliation(input: {
  db: HandoffDatabase;
  jobsDb: HandoffDatabase;
  limit?: number;
}): Promise<number> {
  const rows = await withIdentityTransaction(input.db, {}, (tx) =>
    infrastructureRepository.listAuditLogByActions(tx, {
      actions: PENDING_ACTIONS,
      limit: input.limit ?? 50,
    }),
  );

  let scheduled = 0;
  for (const row of rows) {
    if (row.workspaceId === null || row.entityId === null) continue;
    const result = await withJobTransaction(input.jobsDb, (tx) =>
      jobsRepository.enqueueJob(tx, {
        kind: "reconcile_clerk",
        dedupeKey: reconcileClerkDedupeKey(row.entityType, row.entityId ?? "", row.id),
        workspaceId: row.workspaceId,
        payload: { auditLogId: row.id, action: row.action, entityId: row.entityId },
      }),
    );
    if (result.created) scheduled += 1;
  }
  return scheduled;
}

export const reconcileClerk: JobHandler = async (context) => {
  const { runtime, job } = context;
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success || job.workspaceId === null) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  const { action, entityId } = parsed.data;
  const workspaceId = job.workspaceId;

  const target = await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const workspace = await identityRepository.findWorkspaceById(tx, workspaceId);
    if (workspace === null) return null;
    if (action === PENDING_INVITATION_REVOCATION) {
      const intent = await invitationsRepository.findInvitationById(tx, workspaceId, entityId);
      if (intent === null || intent.clerkInvitationId === null) return null;
      return {
        kind: "invitation" as const,
        clerkOrgId: workspace.clerkOrgId,
        clerkId: intent.clerkInvitationId,
      };
    }
    const user = await identityRepository.findUserById(tx, entityId);
    if (user === null) return null;
    return {
      kind: "membership" as const,
      clerkOrgId: workspace.clerkOrgId,
      clerkId: user.clerkUserId,
    };
  });

  // Nothing left to reconcile: the row it described is gone or never reached Clerk at all.
  if (target === null) return { status: "completed" };

  try {
    await callProvider(runtime.clerk, target);
  } catch (error) {
    // Provider failures stay retryable; the attempt budget is what stops the loop.
    const retryAfterMs = error instanceof ProviderError ? error.retryAfterMs : undefined;
    return {
      status: "failed",
      errorCode: "provider_unavailable",
      retryable: true,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }

  await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      action:
        target.kind === "invitation"
          ? "invitation.clerk_revocation_reconciled"
          : "membership.clerk_removal_reconciled",
      entityType: target.kind === "invitation" ? "invitation_intent" : "workspace_membership",
      entityId,
      requestId: job.id,
    }),
  );
  return { status: "completed" };
};

function callProvider(
  clerk: ClerkGateway,
  target: { kind: "invitation" | "membership"; clerkOrgId: string; clerkId: string },
): Promise<void> {
  if (target.kind === "invitation") {
    return clerk.revokeOrganizationInvitation({
      clerkOrgId: target.clerkOrgId,
      clerkInvitationId: target.clerkId,
    });
  }
  return clerk.removeOrganizationMember({
    clerkOrgId: target.clerkOrgId,
    clerkUserId: target.clerkId,
  });
}
