// Deleting a child or a workspace. The request makes the records inaccessible and schedules the
// durable purge; it never removes a row itself, because the API credential holds no DELETE
// (packages/db/migrations/README.md). A 202 means "queued", not "erased" (data contract §8).
//
// Order matters and is the same for both: mark inaccessible, close declared care, stop pending
// work, enqueue the purge. `authorizeChild` accepts only an `active` child and `authorizeWorkspace`
// only an `active` workspace, so the first step alone is what makes the data disappear from every
// read path within one request.
import {
  careRepository,
  childrenRepository,
  identityRepository,
  infrastructureRepository,
  invitationsRepository,
  jobsRepository,
  purgeRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { ChildScope, ChildStatus, HandoffDatabase, HandoffTransaction } from "@handoff/db";
import { authorizeWorkspace } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { purgeChildDedupeKey, purgeWorkspaceDedupeKey } from "./job-keys";
import { refreshMembershipIfStale } from "./memberships";
import { resolveChildWorkspace } from "./workspace-lookup";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

export interface ChildDeletionResult {
  childId: string;
  status: Extract<ChildStatus, "deleting" | "deleted">;
}

export interface WorkspaceDeletionResult {
  workspaceId: string;
  status: "deleting" | "deleted";
}

/** Enqueued inside the caller's transaction, so scheduling and inaccessibility commit together. */
async function enqueuePurgeChild(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string },
): Promise<void> {
  await jobsRepository.enqueueJob(tx, {
    kind: "purge_child",
    dedupeKey: purgeChildDedupeKey(input.childId),
    workspaceId: input.workspaceId,
    childId: input.childId,
    payload: { childId: input.childId },
  });
}

/**
 * Stops work already in the queue. This is an update on the queue, which only the dispatcher
 * credential may issue, so it runs after the tenant transaction commits rather than inside it.
 * A worker that had already claimed one re-authorizes and finds the child gone.
 */
async function cancelChildWork(jobsDb: HandoffDatabase | null, ids: ChildScope): Promise<void> {
  if (jobsDb === null) return;
  await withJobTransaction(jobsDb, (tx) => purgeRepository.cancelJobsForChild(tx, ids));
}

export async function deleteChild({
  deps,
  actorUserId,
  childId,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
  /** Supplied by an idempotent route so this write and its replay record commit together. */
  tx?: ScopedTransaction;
}): Promise<ChildDeletionResult> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveChildWorkspace({ deps, actorUserId, childId }));

  const status = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const actor = await authorizeWorkspace(scoped, { userId: actorUserId, workspaceId });
    if (actor.membership.appRole !== "owner") {
      throw ApiHttpError.forbidden("Only a workspace owner can delete a child");
    }
    const child = await childrenRepository.findChildInWorkspace(scoped, workspaceId, childId);
    if (child === null) throw ApiHttpError.notFound("That child is not available");

    // A repeated request re-enqueues nothing new: the dedupe key is the semantic identity of
    // this child's purge, so the second call resolves to the job the first one scheduled.
    if (child.status === "deleting" || child.status === "deleted") {
      await enqueuePurgeChild(scoped, { workspaceId, childId });
      return child.status;
    }

    await childrenRepository.markChildDeleting(scoped, { workspaceId, childId });
    // The child is gone for everyone, so nobody is still declaring care for them.
    await careRepository.endAllSessionsForChild(scoped, {
      workspaceId,
      childId,
      endReason: "child_archived",
    });
    await enqueuePurgeChild(scoped, { workspaceId, childId });
    await infrastructureRepository.insertAuditLog(scoped, {
      workspaceId,
      childId,
      actorUserId,
      action: "child.deleted",
      entityType: "child",
      entityId: childId,
      requestId: deps.requestId,
    });
    return "deleting" as const;
  });

  await cancelChildWork(deps.jobsDb, { workspaceId, childId });
  return { childId, status };
}

export async function deleteWorkspace({
  deps,
  actorUserId,
  workspaceId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  workspaceId: string;
}): Promise<WorkspaceDeletionResult> {
  // Deleting a workspace is an admin operation, so provider membership must be fresh (§3).
  await refreshMembershipIfStale({ deps, userId: actorUserId, workspaceId });

  const closed = await withTenantTransaction(deps.db, { workspaceId }, async (scoped) => {
    const actor = await authorizeWorkspace(scoped, { userId: actorUserId, workspaceId });
    if (actor.membership.appRole !== "owner") {
      throw ApiHttpError.forbidden("Only a workspace owner can delete a workspace");
    }
    const marked = await identityRepository.markWorkspaceDeleting(scoped, {
      workspaceId,
      deletedAt: deps.now(),
    });
    // Null means another request already started this; the purge job is keyed by workspace, so
    // enqueueing it again schedules nothing and the caller still gets its 202.
    if (marked === null) {
      await enqueuePurgeWorkspace(scoped, workspaceId);
      return { clerkOrgId: actor.workspace.clerkOrgId, status: "deleting" as const };
    }

    for (const child of await childrenRepository.listAllChildrenForWorkspace(scoped, workspaceId)) {
      await childrenRepository.markChildDeleting(scoped, { workspaceId, childId: child.id });
    }
    await careRepository.endAllSessionsInWorkspace(scoped, {
      workspaceId,
      endReason: "child_archived",
    });
    for (const membership of await identityRepository.listMembershipsForWorkspace(
      scoped,
      workspaceId,
    )) {
      if (membership.status !== "active") continue;
      await identityRepository.revokeMembership(scoped, {
        workspaceId,
        userId: membership.userId,
        expectedVersion: membership.version,
      });
    }
    await invitationsRepository.revokeOpenInvitationsForWorkspace(scoped, workspaceId);
    await enqueuePurgeWorkspace(scoped, workspaceId);
    await infrastructureRepository.insertAuditLog(scoped, {
      workspaceId,
      actorUserId,
      action: "workspace.deleted",
      entityType: "workspace",
      entityId: workspaceId,
      requestId: deps.requestId,
    });
    return { clerkOrgId: actor.workspace.clerkOrgId, status: "deleting" as const };
  });

  if (deps.jobsDb !== null) {
    await withJobTransaction(deps.jobsDb, (tx) =>
      purgeRepository.cancelJobsForWorkspace(tx, workspaceId),
    );
  }
  await deleteClerkOrganization({ deps, workspaceId, actorUserId, clerkOrgId: closed.clerkOrgId });
  return { workspaceId, status: closed.status };
}

async function enqueuePurgeWorkspace(tx: HandoffTransaction, workspaceId: string): Promise<void> {
  await jobsRepository.enqueueJob(tx, {
    kind: "purge_workspace",
    dedupeKey: purgeWorkspaceDedupeKey(workspaceId),
    workspaceId,
    payload: { workspaceId },
  });
}

/**
 * Clerk owns the organization, and no provider call can share a Postgres transaction, so this
 * runs after the local writes commit. A failure is recorded rather than retried inline: local
 * access is already gone, and an operator (or a later reconciliation) removes the organization.
 */
async function deleteClerkOrganization({
  deps,
  workspaceId,
  actorUserId,
  clerkOrgId,
}: {
  deps: ServiceDeps;
  workspaceId: string;
  actorUserId: string;
  clerkOrgId: string;
}): Promise<void> {
  try {
    await deps.clerk.deleteOrganization({ clerkOrgId });
  } catch {
    await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
      infrastructureRepository.insertAuditLog(tx, {
        workspaceId,
        actorUserId,
        action: "workspace.clerk_deletion_pending",
        entityType: "workspace",
        entityId: workspaceId,
        requestId: deps.requestId,
      }),
    );
  }
}
