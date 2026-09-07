// Removing one child's data for good. The request that scheduled this already made the child
// inaccessible; this handler is what actually deletes objects and rows (roadmap milestone 5).
//
// Stages, in order, each safe to repeat:
//
//   mark     the child is `deleting`, which `authorizeChild` already treats as gone
//   cancel   queued and leased work for this child stops, so nothing new is written
//   objects  every stored object is deleted and its quota released or settled exactly once
//   redact   brief snapshots become encrypted empty snapshots; the acknowledgement rows survive
//   rows     journal, media, captures, sessions, cursors, and grants are removed
//   tombstone the child row keeps its id with an encrypted empty profile
//
// Nothing here can race a worker into recreating content: `process_capture` and `validate_media`
// both re-authorize through `authorizeChild`, which refuses a child that is not `active`, so a
// claim that lands mid-purge cancels its own capture instead of publishing an event.
//
// Row removal runs on the dispatcher credential, which is the only one holding DELETE, inside a
// tenant transaction keyed to the workspace from the claimed job row.
import {
  childrenRepository,
  handoffsRepository,
  infrastructureRepository,
  mediaRepository,
  purgeRepository,
  storageQuotaRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { ChildScope, MediaAssetRow } from "@handoff/db";
import { redactedBriefSnapshot } from "../lib/redacted-snapshot";
import { recordStorageLevels } from "../observability/metrics";
import { encryptBriefSnapshot } from "../security/journal-fields";
import { encryptChildTombstone } from "../security/profile-fields";
import type { JobHandler, JobOutcome } from "../types/jobs";
import type { WorkerRuntime } from "../types/runtime";

/** Bounded per pass so one enormous child cannot hold a lease open indefinitely. */
const BATCH_LIMIT = 500;

export const purgeChild: JobHandler = async (context) => {
  const { runtime, job } = context;
  if (job.workspaceId === null || job.childId === null) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  const ids = { workspaceId: job.workspaceId, childId: job.childId };
  await purgeChildData({ runtime, ids, exceptJobId: job.id, saveStage: context.saveCheckpoint });
  return { status: "completed" } satisfies JobOutcome;
};

/**
 * The purge itself, so `purge_workspace` can run it for each of its children without scheduling a
 * second job per child. Every step is idempotent, so a resumed attempt repeats them harmlessly.
 */
export async function purgeChildData({
  runtime,
  ids,
  exceptJobId,
  saveStage,
}: {
  runtime: WorkerRuntime;
  ids: ChildScope;
  /** The purge job's own queue row, which must outlive the rows it removes. */
  exceptJobId: string;
  saveStage?: (checkpoint: unknown) => Promise<boolean>;
}): Promise<void> {
  const { workspaceId, childId } = ids;

  await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    childrenRepository.markChildDeleting(tx, { workspaceId, childId }),
  );
  await withJobTransaction(runtime.jobsDb, (tx) => purgeRepository.cancelJobsForChild(tx, ids));
  await saveStage?.({ stage: "cancelled", childId });

  await deleteObjects(runtime, ids);
  await saveStage?.({ stage: "objects", childId });

  await redactBriefs(runtime, ids);
  await deleteRows(runtime, ids, exceptJobId);
  await saveStage?.({ stage: "rows", childId });

  const profileCiphertext = await encryptChildTombstone(runtime.keys, { workspaceId, childId });
  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    await childrenRepository.markChildDeleted(tx, { workspaceId, childId, profileCiphertext });
    await infrastructureRepository.insertAuditLog(tx, {
      workspaceId,
      childId,
      actorUserId: null,
      action: "child.purged",
      entityType: "child",
      entityId: childId,
      requestId: `job:purge_child:${childId}`,
    });
  });
  runtime.logger.info("child_purged", { workspaceId, childId });
}

/**
 * Claim, delete, record, release: the same shape as the retention sweeps. `markAssetDeleting` is
 * the claim and `markAssetDeleted` is the once-only licence to move a counter, so re-running the
 * purge cannot decrement a workspace's storage twice.
 */
async function deleteObjects(runtime: WorkerRuntime, ids: ChildScope): Promise<void> {
  const assets = await withTenantTransaction(runtime.db, { workspaceId: ids.workspaceId }, (tx) =>
    mediaRepository.listAssetsForChild(tx, { ...ids, limit: BATCH_LIMIT }),
  );
  for (const asset of assets) await purgeAsset(runtime, asset);
}

async function purgeAsset(runtime: WorkerRuntime, asset: MediaAssetRow): Promise<void> {
  const workspaceId = asset.workspaceId;
  // Only `markAssetReady` records a verified MIME, and it is also the only transition that settles
  // bytes into storage_used_bytes. Reading it from the row keeps the decision correct for an asset
  // a crashed earlier attempt already left in `deleting`.
  const wasSettled = asset.verifiedMime !== null;
  const claimed = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    mediaRepository.markAssetDeleting(tx, { workspaceId, assetId: asset.id }),
  );
  if (claimed === null && asset.status !== "deleting") return;

  await runtime.storage.deleteObject(asset.objectKey);

  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const deleted = await mediaRepository.markAssetDeleted(tx, { workspaceId, assetId: asset.id });
    if (deleted === null) return;
    if (wasSettled) {
      recordStorageLevels(
        runtime.metrics,
        await storageQuotaRepository.releaseStoredBytes(tx, {
          workspaceId,
          actualBytes: asset.sizeBytes ?? asset.reservedBytes,
        }),
      );
      return;
    }
    const released = await mediaRepository.markAssetQuotaReleased(tx, {
      workspaceId,
      assetId: asset.id,
    });
    if (released === null) return;
    recordStorageLevels(
      runtime.metrics,
      await storageQuotaRepository.releaseStorageBytes(tx, {
        workspaceId,
        reservedBytes: asset.reservedBytes,
      }),
    );
  });
}

/**
 * Brief rows survive as the record that a recipient acknowledged a handoff, with an encrypted
 * empty snapshot in place of the care they described. The started session is released here because
 * the next stage removes it.
 */
async function redactBriefs(runtime: WorkerRuntime, ids: ChildScope): Promise<void> {
  const briefs = await withTenantTransaction(runtime.db, { workspaceId: ids.workspaceId }, (tx) =>
    handoffsRepository.listBriefsForChild(tx, { ...ids, limit: BATCH_LIMIT }),
  );
  for (const brief of briefs) {
    if (brief.status === "redacted") continue;
    const snapshotCiphertext = await encryptBriefSnapshot(runtime.keys, {
      workspaceId: ids.workspaceId,
      briefId: brief.id,
      snapshot: redactedBriefSnapshot(brief, runtime.now()),
    });
    await withTenantTransaction(runtime.db, { workspaceId: ids.workspaceId }, (tx) =>
      handoffsRepository.redactBrief(tx, {
        workspaceId: ids.workspaceId,
        briefId: brief.id,
        snapshotCiphertext,
      }),
    );
  }
}

/**
 * One transaction on the dispatcher credential, because `events_current_revision_fk` is deferred:
 * revisions and events are only consistent again at commit, so they cannot be split apart.
 */
async function deleteRows(
  runtime: WorkerRuntime,
  ids: ChildScope,
  exceptJobId: string,
): Promise<void> {
  await withTenantTransaction(runtime.jobsDb, { workspaceId: ids.workspaceId }, async (tx) => {
    await purgeRepository.deleteJobsForChild(tx, ids, exceptJobId);
    await purgeRepository.deleteJournalForChild(tx, ids);
    await purgeRepository.deleteMediaAssetsForChild(tx, ids);
    await purgeRepository.deleteCapturesForChild(tx, ids);
    await purgeRepository.deleteCareSessionsForChild(tx, ids);
    await purgeRepository.deleteCursorsForChild(tx, ids);
    await purgeRepository.deleteChildAccessForChild(tx, ids);
  });
}
