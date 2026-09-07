// Abandoned attachment uploads and the objects nobody claims. Architecture §6: purge abandoned
// upload objects after 24 hours, and reconcile objects uploaded without a completion callback.
// Deleting the database row is not deleting the object, so both are tracked to completion and the
// reservation is released exactly once.
import {
  jobsRepository,
  mediaRepository,
  storageQuotaRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { HandoffDatabase, MediaAssetRow, MediaKind } from "@handoff/db";
import { assetIdFromObjectKey, workspaceObjectPrefix } from "../lib/object-key";
import { cleanupUploadsDedupeKey } from "../services/job-keys";
import { recordStorageLevels } from "../observability/metrics";
import type { JobHandler } from "../types/jobs";
import type { WorkerRuntime } from "../types/runtime";

/** Recordings have their own retention sweep; this one owns the gallery attachments. */
const ATTACHMENT_KINDS: readonly MediaKind[] = ["image", "video"];

const EXPIRED_BATCH_LIMIT = 100;

/** Bounded per run: reconciliation is a safety net, not a full bucket audit. */
const RECONCILE_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enqueues the next daily sweep for one workspace. The dedupe key carries the day, so repeating
 * this is free and the queue never accumulates more than one pending sweep per workspace.
 */
export function scheduleUploadCleanup(input: {
  jobsDb: HandoffDatabase;
  workspaceId: string;
  runAt: Date;
}): Promise<unknown> {
  return withJobTransaction(input.jobsDb, (tx) =>
    jobsRepository.enqueueJob(tx, {
      kind: "cleanup_uploads",
      dedupeKey: cleanupUploadsDedupeKey(input.workspaceId, input.runAt),
      workspaceId: input.workspaceId,
      payload: { workspaceId: input.workspaceId },
      availableAt: input.runAt,
    }),
  );
}

export const cleanupUploads: JobHandler = async (context) => {
  const { runtime, job } = context;
  const workspaceId = job.workspaceId;
  if (workspaceId === null) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  const now = runtime.now();

  await purgeExpiredAllocations(runtime, workspaceId, now);
  await reconcileOrphanObjects(runtime, workspaceId);

  // Tomorrow's sweep is queued before this one reports success, so the chain cannot break.
  await scheduleUploadCleanup({
    jobsDb: runtime.jobsDb,
    workspaceId,
    runAt: new Date(now.getTime() + DAY_MS),
  });
  return { status: "completed" };
};

/** Upload authorizations nobody used: the object may or may not exist, the reservation does. */
async function purgeExpiredAllocations(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const expired = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    mediaRepository.listExpiredPendingAssets(tx, now, EXPIRED_BATCH_LIMIT, ATTACHMENT_KINDS),
  );
  for (const asset of expired) await purgeAsset(runtime, asset);
}

/**
 * Claim, delete, record, release. `markAssetDeleting` is the claim, so two sweeps cannot both
 * call the provider, and `markAssetQuotaReleased` is the licence to decrement the counter, so an
 * interrupted cleanup that runs again cannot decrement it twice.
 */
async function purgeAsset(runtime: WorkerRuntime, asset: MediaAssetRow): Promise<void> {
  const workspaceId = asset.workspaceId;
  const claimed = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    mediaRepository.markAssetDeleting(tx, { workspaceId, assetId: asset.id }),
  );
  if (claimed === null) return;

  // A provider failure leaves the asset in `deleting`, which is the record that the object may
  // still exist: the counter is not released for something that is still stored.
  await runtime.storage.deleteObject(asset.objectKey);

  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    await mediaRepository.markAssetDeleted(tx, { workspaceId, assetId: asset.id });
    const released = await mediaRepository.markAssetQuotaReleased(tx, {
      workspaceId,
      assetId: asset.id,
    });
    if (released === null) return;
    const levels = await storageQuotaRepository.releaseStorageBytes(tx, {
      workspaceId,
      reservedBytes: asset.reservedBytes,
    });
    recordStorageLevels(runtime.metrics, levels);
  });
}

/**
 * An upload that finished at the provider but whose completion callback never arrived leaves an
 * object no row names. The bucket is not enumerable from the database, so this walks the
 * workspace's own prefix instead. Every key this server generates ends in the asset id, so an
 * object is only removed when no row of that id exists at all, in any state: a normalized photo
 * written moments before its `ready` transaction committed is not an orphan.
 */
async function reconcileOrphanObjects(runtime: WorkerRuntime, workspaceId: string): Promise<void> {
  const objects = await runtime.storage.listObjects(
    workspaceObjectPrefix(workspaceId),
    RECONCILE_LIMIT,
  );
  const orphans: string[] = [];
  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    for (const object of objects) {
      const assetId = assetIdFromObjectKey(object.objectKey);
      if (assetId === null) {
        // Not a key this server ever generated, so nothing will ever claim it.
        orphans.push(object.objectKey);
        continue;
      }
      const row = await mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, assetId);
      if (row === null) orphans.push(object.objectKey);
    }
  });

  for (const objectKey of orphans) await runtime.storage.deleteObject(objectKey);
  if (orphans.length > 0) {
    // Counts only: an object key names a workspace, child, capture, and asset.
    runtime.logger.info("storage_orphans_removed", { count: orphans.length, workspaceId });
  }
}
