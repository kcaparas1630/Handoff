// What happens after the client has PUT its recording, and what happens when processing failed.
// The upload state and the job are committed together so a capture can never be queued without
// work, or marked uploaded without a stored object (architecture §4).
import { AUDIO_MAX_BYTES } from "@handoff/contracts";
import {
  capturesRepository,
  jobsRepository,
  mediaRepository,
  withJobTransaction,
  withTenantTransaction,
} from "@handoff/db";
import type { CompleteUploadRequest, CompleteUploadResponse, CaptureDto } from "@handoff/contracts";
import type { MediaAssetRow } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { toMediaAssetDto } from "../lib/media-dto";
import { findAudioAsset } from "./capture-uploads";
import { loadAuthorizedCapture, toCaptureDto } from "./captures";
import { cleanupAudioDedupeKey, processCaptureDedupeKey } from "./job-keys";
import { resolveCaptureWorkspace } from "./workspace-lookup";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ServiceDeps } from "../types/runtime";

const DAY_MS = 24 * 60 * 60 * 1000;

function nextDay(now: Date): Date {
  return new Date(now.getTime() + DAY_MS);
}

/**
 * The client reports what it uploaded and the server checks the stored object before it believes
 * any of it. A mismatch leaves the capture `awaiting_upload` so the same authorization can be
 * used to PUT the file again; nothing is queued and no reservation is settled.
 */
export async function completeUpload({
  deps,
  actorUserId,
  captureId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
  input: CompleteUploadRequest;
  /** Supplied by an idempotent route; the service is safe without it. */
  tx?: ScopedTransaction;
}): Promise<CompleteUploadResponse> {
  const workspaceId =
    tx?.workspaceId ?? (await resolveCaptureWorkspace({ deps, actorUserId, captureId }));

  const loaded = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const authorized = await loadAuthorizedCapture(scoped, {
      actorUserId,
      workspaceId,
      captureId,
    });
    // An owner may read another author's recording but not finish their upload (§7).
    if (!authorized.isAuthor) {
      throw ApiHttpError.forbidden("Only the author can complete this upload");
    }
    const asset = await findAudioAsset(scoped, {
      workspaceId,
      childId: authorized.capture.childId,
      captureId,
    });
    if (asset === null) throw ApiHttpError.notFound("That recording has no upload to complete");
    return { capture: authorized.capture, asset };
  });

  // A repeated completion is the same request the caller already made: the capture is already
  // queued and its job already exists, so this returns that result rather than a conflict.
  if (loaded.capture.status !== "awaiting_upload") {
    if (loaded.capture.status === "queued" || loaded.capture.status === "processing") {
      return {
        capture: await toCaptureDto(deps, loaded.capture, true, { audioAsset: loaded.asset }),
        asset: toMediaAssetDto(loaded.asset),
      };
    }
    throw ApiHttpError.conflict("This recording is not waiting for an upload");
  }

  await assertObjectMatches(deps, loaded.asset, input);

  const committed = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const asset = await mediaRepository.markAssetUploaded(scoped, {
      workspaceId,
      assetId: loaded.asset.id,
      expectedVersion: loaded.asset.version,
      sizeBytes: input.sizeBytes,
      ...(input.checksum === undefined ? {} : { checksum: input.checksum }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    });
    if (asset === null) throw ApiHttpError.conflict("This upload was already completed");

    const capture = await capturesRepository.updateCaptureStatus(scoped, {
      workspaceId,
      captureId,
      status: "queued",
    });
    if (capture === null) throw ApiHttpError.notFound("That recording is not available");

    // Same transaction as the upload state: a queued capture always has exactly one job, and a
    // duplicate completion inserts nothing because the dedupe key already exists.
    await jobsRepository.enqueueJob(scoped, {
      kind: "process_capture",
      dedupeKey: processCaptureDedupeKey(captureId),
      workspaceId,
      childId: capture.childId,
      captureId,
      payload: { captureId },
    });

    // Stored audio starts this workspace's retention sweep. The key carries the day, so every
    // later upload schedules nothing and the chain continues from the handler itself.
    await jobsRepository.enqueueJob(scoped, {
      kind: "cleanup_audio",
      dedupeKey: cleanupAudioDedupeKey(workspaceId, nextDay(deps.now())),
      workspaceId,
      payload: { workspaceId },
      availableAt: nextDay(deps.now()),
    });
    return { capture, asset };
  });

  return {
    capture: await toCaptureDto(deps, committed.capture, true, { audioAsset: committed.asset }),
    asset: toMediaAssetDto(committed.asset),
  };
}

/**
 * The stored object decides, not the request body. A missing object, a size over the product
 * limit, or a size the client did not report are all refused before any state moves.
 */
async function assertObjectMatches(
  deps: ServiceDeps,
  asset: MediaAssetRow,
  input: CompleteUploadRequest,
): Promise<void> {
  if (deps.storage === null) {
    throw ApiHttpError.providerUnavailable("Recording storage is not available right now");
  }
  const head = await deps.storage.headObject(asset.objectKey);
  if (head === null) {
    throw ApiHttpError.validationFailed("That recording has not finished uploading", {
      sizeBytes: ["No stored recording was found for this capture"],
    });
  }
  if (head.sizeBytes > AUDIO_MAX_BYTES) {
    throw ApiHttpError.validationFailed("That recording is larger than the limit", {
      sizeBytes: ["A recording may be at most 10 MB"],
    });
  }
  if (head.sizeBytes !== input.sizeBytes) {
    throw ApiHttpError.validationFailed("That recording did not upload completely", {
      sizeBytes: ["The stored recording does not match the reported size"],
    });
  }
}

/**
 * Requeues a visibly failed capture. The job keeps its checkpoints, so an extraction retry does
 * not pay for transcription again (architecture §4). The job is requeued before the capture is,
 * which makes a repeated retry a no-op instead of leaving work no one will pick up.
 */
export async function retryCapture({
  deps,
  actorUserId,
  captureId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
}): Promise<CaptureDto> {
  const workspaceId = await resolveCaptureWorkspace({ deps, actorUserId, captureId });
  const loaded = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
    loadAuthorizedCapture(tx, { actorUserId, workspaceId, captureId }),
  );
  if (loaded.capture.status !== "failed") {
    throw ApiHttpError.conflict("This recording is not waiting to be retried");
  }

  const jobsDb = deps.jobsDb;
  if (jobsDb === null) {
    throw ApiHttpError.providerUnavailable("Processing is not available right now");
  }
  const dedupeKey = processCaptureDedupeKey(captureId);
  await withJobTransaction(jobsDb, async (tx) => {
    const existing = await jobsRepository.findJobByDedupeKey(tx, dedupeKey);
    if (existing === null) {
      await jobsRepository.enqueueJob(tx, {
        kind: "process_capture",
        dedupeKey,
        workspaceId,
        childId: loaded.capture.childId,
        captureId,
        payload: { captureId },
      });
      return;
    }
    // Only a failed job is requeued; one already queued or leased is the retry the caller wanted.
    if (existing.status === "failed") {
      await jobsRepository.requeueFailedJob(tx, { jobId: existing.id, availableAt: deps.now() });
    }
  });

  const capture = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
    capturesRepository.updateCaptureStatus(tx, { workspaceId, captureId, status: "queued" }),
  );
  if (capture === null) throw ApiHttpError.notFound("That recording is not available");
  const asset = await withTenantTransaction(deps.db, { workspaceId }, (tx) =>
    findAudioAsset(tx, { workspaceId, childId: capture.childId, captureId }),
  );
  return toCaptureDto(deps, capture, true, { audioAsset: asset });
}
