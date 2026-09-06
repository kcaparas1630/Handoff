// The only thing that publishes an attachment. It reads the stored bytes, decides what they
// actually are, normalizes a photo, and then appends a `media_updated` revision to every confirmed
// event of the capture that does not already carry the asset (architecture §5, §6).
//
// Stages, in order, each safe to repeat:
//
//   load     the asset must still be `uploaded`; a `ready` one skips straight to publish
//   inspect  read the object, bounded by the kind's limit, and check the bytes
//   reject   mark rejected, release the reservation once, delete the object
//   publish  normalize a photo to a new key, mark ready and settle the reservation, delete the
//            raw object, then append one revision per affected event
//
// A crash between any two stages leaves the row in the state the next attempt reads, and every
// database transition names the status it comes from, so nothing moves twice.
import { randomUUID } from "node:crypto";
import {
  eventsRepository,
  mediaRepository,
  storageQuotaRepository,
  withTenantTransaction,
} from "@handoff/db";
import { canCreateCapture } from "@handoff/domain";
import type { EventRow, HandoffTransaction, MediaAssetRow } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { eventFactsFromRow, eventPayloadOf, revisionSnapshotOf } from "../lib/event-dto";
import { buildNormalizedImageKey, buildObjectKey } from "../lib/object-key";
import { inspectMedia, isRejected } from "../media/inspect";
import { attachmentLimitsForAsset } from "../media/lib/attachment-limits";
import { normalizeImage } from "../media/normalize-image";
import {
  decryptEventPayload,
  decryptRevisionSnapshot,
  encryptEventPayload,
  encryptRevisionSnapshot,
} from "../security/journal-fields";
import { withRequestKeyCache } from "../security/request-key-cache";
import type { DataKeyService } from "../security/encryption/data-keys";
import type { InspectedMedia } from "../media/inspect";
import type { JobHandler, JobOutcome } from "../types/jobs";
import type { WorkerRuntime } from "../types/runtime";

export const validateMedia: JobHandler = async (context) => {
  const { runtime, job } = context;
  if (job.workspaceId === null || job.childId === null || job.assetId === null) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  const ids = { workspaceId: job.workspaceId, childId: job.childId, assetId: job.assetId };

  const loaded = await withTenantTransaction(
    runtime.db,
    { workspaceId: ids.workspaceId },
    async (tx) => {
      const row = await mediaRepository.findMediaAssetInWorkspace(tx, ids.workspaceId, ids.assetId);
      if (row === null || row.childId !== ids.childId) return null;
      return { asset: row, uploaderMayPublish: await mayStillPublish(tx, row) };
    },
  );
  // A missing asset, or one already rejected or purged, means this unit of work is settled.
  if (loaded === null) return { status: "completed" };
  const asset = loaded.asset;
  if (asset.kind === "audio") {
    // Recordings are validated by transcription, not here; their quota settles in process_capture.
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  if (asset.status !== "uploaded" && asset.status !== "ready") return { status: "completed" };
  // Reauthorized before any work, like every other job: an attachment from a caregiver who has
  // since lost this child is discarded rather than published (architecture §4).
  if (!loaded.uploaderMayPublish) {
    if (asset.status === "ready") return { status: "completed" };
    return reject(runtime, asset, "revoked");
  }
  // An earlier attempt published the asset but died before it wrote the revisions.
  if (asset.status === "ready") return publish(runtime, asset);

  const limits = attachmentLimitsForAsset(asset.kind);
  const bytes = await runtime.storage.readObject(asset.objectKey, limits.maxBytes);
  const inspected = await inspectMedia({
    bytes,
    declaredMime: asset.declaredMime,
    kind: asset.kind === "video" ? "video" : "image",
  });
  if (isRejected(inspected)) return reject(runtime, asset, inspected.rejected);

  const published = await markReady(runtime, asset, bytes, inspected);
  // Null means another attempt moved the row between the read and the write; it owns the publish.
  if (published === null) return { status: "completed" };
  return publish(runtime, published);
};

/** False when the uploader may no longer add to this child's journal (data contract §7). */
async function mayStillPublish(tx: HandoffTransaction, asset: MediaAssetRow): Promise<boolean> {
  try {
    const authorization = await authorizeChild(tx, {
      userId: asset.uploadedByUserId,
      workspaceId: asset.workspaceId,
      childId: asset.childId,
    });
    return canCreateCapture(
      accessContextOf(authorization.membership.appRole, authorization.permission),
    );
  } catch (error) {
    // A missing membership, grant, or child is an ordinary not-found from the authorization
    // helper; here it means this attachment may no longer be published.
    if (error instanceof ApiHttpError) return false;
    throw error;
  }
}

/**
 * A rejected upload never becomes visible. The reservation is released under the cleanup marker,
 * so a retry that reaches this stage again cannot decrement the counter twice, and the object is
 * removed afterwards because deleting it is idempotent while the counter move is not.
 */
async function reject(
  runtime: WorkerRuntime,
  asset: MediaAssetRow,
  reason: string,
): Promise<JobOutcome> {
  const workspaceId = asset.workspaceId;
  await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    await mediaRepository.markAssetRejected(tx, { workspaceId, assetId: asset.id });
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
  await runtime.storage.deleteObject(asset.objectKey);
  // The reason is a closed code, not the decoder's message or anything from the file itself.
  console.info(
    JSON.stringify({ event: "media_rejected", assetId: asset.id, kind: asset.kind, reason }),
  );
  return { status: "completed" };
}

/**
 * A photo is republished as a normalized JPEG under a new key, so the raw camera file with its
 * metadata never becomes the object a reader is signed for. A video is stored as uploaded:
 * transcoding is deferred (architecture §6).
 */
async function markReady(
  runtime: WorkerRuntime,
  asset: MediaAssetRow,
  bytes: Buffer,
  inspected: InspectedMedia,
): Promise<MediaAssetRow | null> {
  const workspaceId = asset.workspaceId;
  const publishedKey =
    asset.kind === "image"
      ? buildNormalizedImageKey({
          workspaceId,
          childId: asset.childId,
          captureId: asset.captureId,
          assetId: asset.id,
        })
      : asset.objectKey;

  let publishedMime = inspected.verifiedMime;
  let publishedSize = bytes.byteLength;
  if (asset.kind === "image") {
    const normalized = await normalizeImage(bytes);
    publishedMime = normalized.mime;
    publishedSize = normalized.bytes.byteLength;
    // The upload token forbids upsert, and so does putObject, so a retry that already wrote this
    // key clears it first. Deleting an object that is not there is a success.
    await runtime.storage.deleteObject(publishedKey);
    await runtime.storage.putObject(publishedKey, normalized.bytes, normalized.mime);
  }

  const ready = await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const row = await mediaRepository.markAssetReady(tx, {
      workspaceId,
      assetId: asset.id,
      verifiedMime: publishedMime,
      objectKey: publishedKey,
      sizeBytes: publishedSize,
      expectedVersion: asset.version,
      ...(inspected.durationMs === undefined ? {} : { durationMs: inspected.durationMs }),
    });
    if (row === null) return null;
    // The transition above is the licence to move the counter, in this same transaction.
    await storageQuotaRepository.settleStorageBytes(tx, {
      workspaceId,
      reservedBytes: row.reservedBytes,
      actualBytes: publishedSize,
    });
    return row;
  });
  if (ready === null) {
    // Lost the race. Leave the normalized object alone: whichever attempt won points at it.
    return null;
  }

  // Only now is the raw upload removed. Before the commit above it is the only copy a retry
  // could re-read, so deleting it earlier would make a crash unrecoverable.
  if (asset.kind === "image" && asset.objectKey !== publishedKey) {
    await runtime.storage.deleteObject(asset.objectKey);
  }
  return ready;
}

/**
 * Publishes the ready asset onto the capture's confirmed events. One `media_updated` revision per
 * affected event under the child lock (data contract §3); an event whose current snapshot already
 * lists the asset is skipped, which is what makes a replayed job append nothing.
 *
 * A capture still under review has no events yet. That is not a failure: the attachment is ready,
 * and confirmation puts it in each new event's first snapshot.
 */
async function publish(runtime: WorkerRuntime, asset: MediaAssetRow): Promise<JobOutcome> {
  const workspaceId = asset.workspaceId;
  // Every event of one capture shares a data key, and the lock is held while they are rewritten.
  const keys = withRequestKeyCache(runtime.keys);
  await deleteSupersededRawUpload(runtime, asset);

  const appended = await withTenantTransaction(runtime.db, { workspaceId }, async (tx) => {
    const locked = await eventsRepository.lockChildForJournalWrite(tx, workspaceId, asset.childId);
    if (locked === null) return 0;
    const rows = (
      await eventsRepository.listEventsForCapture(tx, workspaceId, asset.captureId)
    ).filter((row) => row.status === "active");

    let count = 0;
    for (const row of rows) {
      const wrote = await attachToEvent(tx, { keys, asset, event: row });
      if (wrote) count += 1;
    }
    return count;
  });
  console.info(
    JSON.stringify({ event: "media_published", assetId: asset.id, revisions: appended }),
  );
  return { status: "completed" };
}

/**
 * A photo published under its normalized key leaves the raw camera file behind if the worker died
 * between writing one and committing the other. The key is derivable, so a resumed attempt clears
 * it; a provider failure here is logged rather than fatal, because the attachment is already
 * published and the reconciliation sweep removes an object no asset row names.
 */
async function deleteSupersededRawUpload(
  runtime: WorkerRuntime,
  asset: MediaAssetRow,
): Promise<void> {
  if (asset.kind !== "image") return;
  const rawKey = buildObjectKey({
    workspaceId: asset.workspaceId,
    childId: asset.childId,
    captureId: asset.captureId,
    assetId: asset.id,
    mime: asset.declaredMime,
  });
  if (rawKey === asset.objectKey) return;
  try {
    await runtime.storage.deleteObject(rawKey);
  } catch {
    console.info(JSON.stringify({ event: "media_raw_delete_deferred", assetId: asset.id }));
  }
}

/** False when this event already publishes the asset, which is the replay guard. */
async function attachToEvent(
  tx: HandoffTransaction,
  input: { keys: DataKeyService; asset: MediaAssetRow; event: EventRow },
): Promise<boolean> {
  const { asset, event, keys } = input;
  const revisions = await eventsRepository.listRevisionsForEvent(
    tx,
    event.workspaceId,
    event.childId,
    event.id,
  );
  const current = revisions.find((revision) => revision.id === event.currentRevisionId);
  if (current === undefined) return false;

  const snapshot = await decryptRevisionSnapshot(keys, {
    workspaceId: event.workspaceId,
    revisionId: current.id,
    envelope: current.contentCiphertext,
  });
  if (snapshot.readyAssetIds.includes(asset.id)) return false;

  const payload = await decryptEventPayload(keys, {
    workspaceId: event.workspaceId,
    eventId: event.id,
    envelope: event.payloadCiphertext,
  });
  // The event's own values do not change: this revision publishes an attachment, nothing else.
  const facts = eventFactsFromRow(event, payload);
  const journalSeq = await eventsRepository.allocateJournalSeq(
    tx,
    event.workspaceId,
    event.childId,
  );
  const revisionId = randomUUID();

  const updated = await eventsRepository.appendEventRevision(tx, {
    workspaceId: event.workspaceId,
    childId: event.childId,
    eventId: event.id,
    expectedVersion: event.version,
    patch: {
      occurredAt: facts.occurredAt,
      endedAt: facts.endedAt,
      timezone: facts.timezone,
      timePrecision: facts.timePrecision,
      payloadCiphertext: await encryptEventPayload(keys, {
        workspaceId: event.workspaceId,
        eventId: event.id,
        payload: eventPayloadOf(facts),
      }),
      important: facts.important,
      status: facts.status,
    },
    revision: {
      id: revisionId,
      journalSeq,
      operation: "media_updated",
      // The caregiver who uploaded the photo is the actor, not the worker.
      actorUserId: asset.uploadedByUserId,
      contentCiphertext: await encryptRevisionSnapshot(keys, {
        workspaceId: event.workspaceId,
        revisionId,
        snapshot: revisionSnapshotOf(facts, snapshot.sourceQuote, [
          ...snapshot.readyAssetIds,
          asset.id,
        ]),
      }),
      sourceStart: current.sourceStart,
      sourceEnd: current.sourceEnd,
    },
  });
  return updated !== null;
}
