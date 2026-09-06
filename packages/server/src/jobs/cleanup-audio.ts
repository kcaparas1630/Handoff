// Retention for source material. Deleting database rows is not deleting storage objects, so both
// are tracked to completion (data contract §9, invariant 10): the object goes first, then the row
// records that it did, then the reservation is released exactly once.
import {
  capturesRepository,
  jobsRepository,
  mediaRepository,
  storageQuotaRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { HandoffDatabase, MediaAssetRow } from "@handoff/db";
import { cleanupAudioDedupeKey } from "../services/job-keys";
import type { JobHandler } from "../types/jobs";
import type { WorkerRuntime } from "../types/runtime";

/** Raw audio is deleted this long after its capture is confirmed (architecture §6). */
const CONFIRMED_RETENTION_DAYS = 7;

/** An unfinished recording is abandoned after the same interval and marked for cleanup. */
const ABANDONED_CAPTURE_DAYS = 7;

const BATCH_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enqueues the next daily sweep for one workspace. The dedupe key carries the day, so repeating
 * this is free and the queue never accumulates more than one pending sweep per workspace.
 */
export function scheduleAudioCleanup(input: {
  jobsDb: HandoffDatabase;
  workspaceId: string;
  runAt: Date;
}): Promise<unknown> {
  return withJobTransaction(input.jobsDb, (tx) =>
    jobsRepository.enqueueJob(tx, {
      kind: "cleanup_audio",
      dedupeKey: cleanupAudioDedupeKey(input.workspaceId, input.runAt),
      workspaceId: input.workspaceId,
      payload: { workspaceId: input.workspaceId },
      availableAt: input.runAt,
    }),
  );
}

export const cleanupAudio: JobHandler = async (context) => {
  const { runtime, job } = context;
  const workspaceId = job.workspaceId;
  if (workspaceId === null) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  const now = runtime.now();

  await deleteExpiredAllocations(runtime, workspaceId, now);
  await deleteConfirmedRecordings(runtime, workspaceId, now);
  await cancelAbandonedCaptures(runtime, workspaceId, now);

  // Tomorrow's sweep is queued before this one reports success, so the chain cannot break.
  await scheduleAudioCleanup({
    jobsDb: runtime.jobsDb,
    workspaceId,
    runAt: new Date(now.getTime() + DAY_MS),
  });
  return { status: "completed" };
};

/** Upload tokens that were never used: the object may or may not exist, the reservation does. */
async function deleteExpiredAllocations(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const expired = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    mediaRepository.listExpiredPendingAssets(tx, now, BATCH_LIMIT),
  );
  for (const asset of expired) await purgeAsset(runtime, asset);
}

async function deleteConfirmedRecordings(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const confirmedBefore = new Date(now.getTime() - CONFIRMED_RETENTION_DAYS * DAY_MS);
  const assets = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    mediaRepository.listAudioForCleanup(tx, confirmedBefore, BATCH_LIMIT),
  );
  for (const asset of assets) await purgeAsset(runtime, asset);
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
    await storageQuotaRepository.releaseStorageBytes(tx, {
      workspaceId,
      reservedBytes: asset.reservedBytes,
    });
  });
}

/** An unfinished recording nobody came back to. Its queued work stops with it. */
async function cancelAbandonedCaptures(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
): Promise<void> {
  const before = new Date(now.getTime() - ABANDONED_CAPTURE_DAYS * DAY_MS);
  const abandoned = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    capturesRepository.listUnconfirmedCapturesBefore(tx, {
      workspaceId,
      before,
      limit: BATCH_LIMIT,
    }),
  );
  for (const capture of abandoned) {
    await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
      capturesRepository.updateCaptureStatus(tx, {
        workspaceId,
        captureId: capture.id,
        status: "cancelled",
      }),
    );
    // Cancelling queued work is an update on the queue, which is the dispatcher's capability.
    await withJobTransaction(runtime.jobsDb, (tx) =>
      jobsRepository.cancelJobsForCapture(tx, { workspaceId, captureId: capture.id }),
    );
  }
}
