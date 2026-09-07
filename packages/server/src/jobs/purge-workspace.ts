// Removing a whole workspace. Every child is purged with the same handler a single-child deletion
// uses, then the identity rows that only existed to reach those children are removed, and finally
// the scope keys are demoted so nothing can be encrypted under them again.
//
// The keys are demoted, not destroyed. Retiring a key that a retained encrypted backup still needs
// is unrecoverable, so retirement waits for `WORKSPACE_KEY_RETENTION_DAYS` and is a separate,
// operator-scheduled step (docs/pii-encryption.md, docs/runbook.md).
import {
  identityRepository,
  infrastructureRepository,
  purgeRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import { retireWorkspaceKeysIfDue } from "../services/key-rotation";
import { purgeChildData } from "./purge-child";
import type { JobHandler, JobOutcome } from "../types/jobs";

export const purgeWorkspace: JobHandler = async (context) => {
  const { runtime, job } = context;
  const workspaceId = job.workspaceId;
  if (workspaceId === null) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }

  // Anything still queued for this workspace stops before the rows it names are removed.
  await withJobTransaction(runtime.jobsDb, (tx) =>
    purgeRepository.cancelJobsForWorkspace(tx, workspaceId),
  );

  const childIds = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    purgeRepository.listChildIdsToPurge(tx, workspaceId),
  );
  for (const childId of childIds) {
    await purgeChildData({ runtime, ids: { workspaceId, childId }, exceptJobId: job.id });
    await context.saveCheckpoint({ stage: "children", childId });
  }

  // Briefs survive a single-child purge as redacted acknowledgement records. Once the workspace
  // itself is gone there is nobody left to consult them, and the membership rows they reference
  // are about to go, so they are removed rather than kept.
  await withTenantTransaction(runtime.jobsDb, { workspaceId }, async (tx) => {
    await purgeRepository.deleteBriefsForWorkspace(tx, workspaceId);
    await purgeRepository.deleteInvitationsForWorkspace(tx, workspaceId);
    await purgeRepository.deleteIdempotencyRequestsForWorkspace(tx, workspaceId);
    await purgeRepository.deleteMembershipsForWorkspace(tx, workspaceId);
    await purgeRepository.deleteJobsForWorkspace(tx, workspaceId, job.id);
  });
  await context.saveCheckpoint({ stage: "identity" });

  const keys = await retireWorkspaceKeysIfDue({ runtime, workspaceId });
  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    await identityRepository.markWorkspaceDeleted(tx, workspaceId);
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      actorUserId: null,
      action: "workspace.purged",
      entityType: "workspace",
      entityId: workspaceId,
      requestId: `job:purge_workspace:${workspaceId}`,
    });
  });
  runtime.logger.info("workspace_purged", {
    workspaceId,
    count: childIds.length,
    status: keys.retired > 0 ? "keys_retired" : "keys_decrypt_only",
  });
  return { status: "completed" } satisfies JobOutcome;
};
