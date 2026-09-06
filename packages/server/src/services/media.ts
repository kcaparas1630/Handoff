// Photo and short-video attachments: allocating one, confirming its upload, and handing out a
// short-lived read URL. Nothing here publishes an asset. The worker's `validate_media` job is the
// only thing that moves an asset to `ready`, because only it has looked at the bytes
// (architecture §6, roadmap milestone 4 logic boundaries).
import { randomUUID } from "node:crypto";
import { MAX_ATTACHMENTS_PER_CAPTURE } from "@handoff/contracts";
import {
  jobsRepository,
  mediaRepository,
  storageQuotaRepository,
  withTenantTransaction,
} from "@handoff/db";
import { canCreateCapture } from "@handoff/domain";
import type {
  AssetReadResponse,
  CompleteUploadRequest,
  CreateAssetUploadRequest,
  CreateAssetUploadResponse,
  MediaAssetDto,
} from "@handoff/contracts";
import type { HandoffTransaction, MediaAssetRow, MediaKind } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { accessContextOf } from "../lib/access-context";
import { inTenantTransaction } from "../lib/in-tenant-transaction";
import { toMediaAssetDto } from "../lib/media-dto";
import { buildObjectKey } from "../lib/object-key";
import { attachmentLimitsFor, attachmentLimitsForAsset } from "../media/lib/attachment-limits";
import { loadAuthorizedCapture } from "./captures";
import { UPLOAD_AUTHORIZATION_SECONDS, requireStorage } from "./capture-uploads";
import { cleanupUploadsDedupeKey, validateMediaDedupeKey } from "./job-keys";
import { resolveAssetLocation, resolveCaptureWorkspace } from "./workspace-lookup";
import type { ScopedTransaction } from "../lib/in-tenant-transaction";
import type { ObjectStorage } from "../storage/object-storage";
import type { ServiceDeps } from "../types/runtime";

/** An unfinished upload's object and reservation are purged after this (architecture §6). */
const PENDING_ASSET_HOURS = 24;

/** Proposed read TTL: long enough to start a download, short enough to be worth reissuing (§6). */
export const READ_URL_SECONDS = 60;

/** The attachment kinds; audio is created with its capture and is not a gallery attachment. */
const ATTACHMENT_KINDS: readonly MediaKind[] = ["image", "video"];

const DAY_MS = 24 * 60 * 60 * 1000;

function nextDay(now: Date): Date {
  return new Date(now.getTime() + DAY_MS);
}

/**
 * Reserves quota and allocates one object for a photo or a short video. Attachments may be added
 * while the draft is under review and after the capture is confirmed (architecture §6), so both
 * statuses are accepted; a confirmed capture's attachment is published onto its events by the
 * validation job.
 */
export async function createAssetUpload({
  deps,
  actorUserId,
  captureId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  captureId: string;
  input: CreateAssetUploadRequest;
  /** Supplied by an idempotent route; the service is safe without it. */
  tx?: ScopedTransaction;
}): Promise<CreateAssetUploadResponse> {
  const storage = requireStorage(deps.storage);
  assertAttachmentIsAllowed(input);
  const workspaceId =
    tx?.workspaceId ?? (await resolveCaptureWorkspace({ deps, actorUserId, captureId }));

  const asset = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const loaded = await loadAuthorizedCapture(scoped, { actorUserId, workspaceId, captureId });
    const context = accessContextOf(
      loaded.authorization.membership.appRole,
      loaded.authorization.permission,
    );
    // §7 "Attach media": the capture's own author, or a workspace owner acting on it. A reader
    // cannot add to the journal at all, whichever capture it is.
    if (!canCreateCapture(context)) {
      throw ApiHttpError.forbidden("You can read this child's journal but not add to it");
    }
    if (!loaded.isAuthor && loaded.authorization.membership.appRole !== "owner") {
      throw ApiHttpError.forbidden("Only the author can attach to this recording");
    }
    const status = loaded.capture.status;
    if (status !== "needs_review" && status !== "confirmed") {
      throw ApiHttpError.conflict("This recording cannot take an attachment yet");
    }

    const childId = loaded.capture.childId;
    const attached = await mediaRepository.countAssetsForCapture(scoped, {
      workspaceId,
      childId,
      captureId,
      kinds: ATTACHMENT_KINDS,
    });
    if (attached >= MAX_ATTACHMENTS_PER_CAPTURE) {
      throw ApiHttpError.validationFailed("That recording already has its attachments", {
        kind: [`A recording may have at most ${String(MAX_ATTACHMENTS_PER_CAPTURE)} attachments`],
      });
    }

    // The reservation comes first, and concurrent allocations serialize on the workspace row, so
    // two requests cannot spend the same remaining budget (data contract §3).
    const reserved = await storageQuotaRepository.reserveStorageBytes(scoped, {
      workspaceId,
      bytes: input.declaredSizeBytes,
    });
    if (reserved === null) {
      throw ApiHttpError.validationFailed("This workspace has no storage left for an attachment", {
        storage: ["Workspace storage budget exceeded"],
      });
    }

    // An allocation is what creates an object that can be abandoned, so the sweep that purges it
    // starts here. The key carries the day, so every later allocation schedules nothing and the
    // chain continues from the handler itself.
    await jobsRepository.enqueueJob(scoped, {
      kind: "cleanup_uploads",
      dedupeKey: cleanupUploadsDedupeKey(workspaceId, nextDay(deps.now())),
      workspaceId,
      payload: { workspaceId },
      availableAt: nextDay(deps.now()),
    });

    const assetId = randomUUID();
    return mediaRepository.insertMediaAsset(scoped, {
      id: assetId,
      workspaceId,
      childId,
      captureId,
      uploadedByUserId: actorUserId,
      kind: input.kind,
      storageProvider: storage.provider,
      bucket: storage.bucket,
      objectKey: buildObjectKey({
        workspaceId,
        childId,
        captureId,
        assetId,
        mime: input.declaredMime,
      }),
      declaredMime: input.declaredMime,
      reservedBytes: input.declaredSizeBytes,
      expiresAt: new Date(deps.now().getTime() + PENDING_ASSET_HOURS * 60 * 60 * 1000),
    });
  });

  return { asset: toMediaAssetDto(asset), upload: await authorizeAttachmentUpload(storage, asset) };
}

/**
 * Signed after the transaction commits and never stored. A re-signed authorization covers the
 * same server-generated key with `x-upsert: false`, so a second PUT cannot replace bytes the
 * worker may already have validated.
 */
async function authorizeAttachmentUpload(storage: ObjectStorage, asset: MediaAssetRow) {
  if (asset.status !== "pending_upload") {
    // Belt and braces: an authorization is only ever issued for an allocation nothing has stored.
    throw ApiHttpError.conflict("That attachment has already been uploaded");
  }
  const maxBytes = attachmentLimitsForAsset(asset.kind).maxBytes;
  const authorization = await storage.createUploadAuthorization({
    objectKey: asset.objectKey,
    contentType: asset.declaredMime,
    maxBytes,
    expiresInSeconds: UPLOAD_AUTHORIZATION_SECONDS,
  });
  return {
    assetId: asset.id,
    method: "PUT" as const,
    url: authorization.url,
    headers: authorization.headers,
    expiresAt: authorization.expiresAt.toISOString(),
    maxBytes,
  };
}

/** The declared shape is refused before any quota is spent or any provider is called. */
function assertAttachmentIsAllowed(input: CreateAssetUploadRequest): void {
  const limits = attachmentLimitsFor(input.kind);
  const fieldErrors: Record<string, string[]> = {};
  if (!limits.mimeTypes.includes(input.declaredMime)) {
    fieldErrors["declaredMime"] = ["That attachment format is not supported"];
  }
  if (input.declaredSizeBytes > limits.maxBytes) {
    fieldErrors["declaredSizeBytes"] = [limits.sizeMessage];
  }
  if (
    limits.maxDurationMs !== null &&
    input.declaredDurationMs !== undefined &&
    input.declaredDurationMs > limits.maxDurationMs
  ) {
    fieldErrors["declaredDurationMs"] = ["A video may be at most 15 seconds"];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw ApiHttpError.validationFailed("That attachment cannot be uploaded", fieldErrors);
  }
}

/**
 * The uploader reports what it stored and the server checks the object before it believes any of
 * it. The key is the one the allocation generated, so a client cannot point this at another
 * object; a mismatch leaves the asset `pending_upload` so the same authorization can be reused.
 */
export async function completeAssetUpload({
  deps,
  actorUserId,
  assetId,
  input,
  tx,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  assetId: string;
  input: CompleteUploadRequest;
  tx?: ScopedTransaction;
}): Promise<MediaAssetDto> {
  const location = await resolveAssetLocation({ deps, actorUserId, assetId });
  const workspaceId = location.workspaceId;

  const loaded = await inTenantTransaction(deps, workspaceId, tx, (scoped) =>
    loadUploaderAsset(scoped, { actorUserId, workspaceId, assetId }),
  );
  // A repeated completion is the same request the caller already made: the asset is uploaded or
  // published and its validation job exists, so this returns that state instead of a conflict.
  if (loaded.status !== "pending_upload") {
    if (loaded.status === "uploaded" || loaded.status === "ready") return toMediaAssetDto(loaded);
    throw ApiHttpError.conflict("This attachment is not waiting for an upload");
  }

  await assertStoredObjectMatches(deps, loaded, input);

  const committed = await inTenantTransaction(deps, workspaceId, tx, async (scoped) => {
    const asset = await mediaRepository.markAssetUploaded(scoped, {
      workspaceId,
      assetId,
      expectedVersion: loaded.version,
      sizeBytes: input.sizeBytes,
      ...(input.checksum === undefined ? {} : { checksum: input.checksum }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    });
    if (asset === null) throw ApiHttpError.conflict("This upload was already completed");

    // Same transaction as the upload state, keyed by the asset: an uploaded attachment always has
    // exactly one validation job, and a duplicate completion inserts nothing.
    await jobsRepository.enqueueJob(scoped, {
      kind: "validate_media",
      dedupeKey: validateMediaDedupeKey(assetId),
      workspaceId,
      childId: asset.childId,
      captureId: asset.captureId,
      assetId,
      payload: { assetId },
    });
    return asset;
  });
  return toMediaAssetDto(committed);
}

/**
 * A fresh short-lived URL for one asset, issued only after the caller is reauthorized for the
 * child (architecture §6). Images and videos must be `ready`: an asset nobody has inspected is
 * never exposed, and an unready or rejected one is the same 404 as an unknown id. Raw audio keeps
 * its source restrictions and is readable only by its author or a workspace owner (§7).
 */
export async function getAssetReadUrl({
  deps,
  actorUserId,
  assetId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  assetId: string;
}): Promise<AssetReadResponse> {
  const storage = requireStorage(deps.storage);
  const { workspaceId } = await resolveAssetLocation({ deps, actorUserId, assetId });

  const asset = await withTenantTransaction(deps.db, { workspaceId }, async (tx) => {
    const row = await mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, assetId);
    if (row === null) throw ApiHttpError.notFound("That attachment is not available");
    const authorization = await authorizeChild(tx, {
      userId: actorUserId,
      workspaceId,
      childId: row.childId,
    });

    if (row.kind === "audio") {
      const isUploader = row.uploadedByUserId === actorUserId;
      if (!isUploader && authorization.membership.appRole !== "owner") {
        throw ApiHttpError.notFound("That attachment is not available");
      }
      if (row.status !== "uploaded" && row.status !== "ready") {
        throw ApiHttpError.notFound("That attachment is not available");
      }
      return row;
    }

    if (row.status !== "ready") throw ApiHttpError.notFound("That attachment is not available");
    return row;
  });

  // The URL is returned to this caller and nowhere else: it is not stored, not logged, and not
  // replayed from an idempotency record (docs/pii-encryption.md).
  const url = await storage.createReadUrl(asset.objectKey, READ_URL_SECONDS);
  return {
    asset: toMediaAssetDto(asset),
    url,
    expiresAt: new Date(deps.now().getTime() + READ_URL_SECONDS * 1000).toISOString(),
  };
}

/**
 * The ready attachments an event's current revision publishes. The snapshot is the source of
 * truth for what a reader may see, so an asset removed from it stops appearing immediately.
 */
export async function listAssetsForEvent(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; readyAssetIds: readonly string[] },
): Promise<MediaAssetDto[]> {
  const assets: MediaAssetDto[] = [];
  for (const assetId of input.readyAssetIds) {
    const row = await mediaRepository.findMediaAssetInWorkspace(tx, input.workspaceId, assetId);
    if (row === null || row.childId !== input.childId || row.status !== "ready") continue;
    assets.push(toMediaAssetDto(row));
  }
  return assets;
}

/** Only the caregiver who allocated the upload may report that it finished. */
async function loadUploaderAsset(
  tx: HandoffTransaction,
  input: { actorUserId: string; workspaceId: string; assetId: string },
): Promise<MediaAssetRow> {
  const asset = await mediaRepository.findMediaAssetInWorkspace(
    tx,
    input.workspaceId,
    input.assetId,
  );
  if (asset === null) throw ApiHttpError.notFound("That attachment is not available");
  await authorizeChild(tx, {
    userId: input.actorUserId,
    workspaceId: input.workspaceId,
    childId: asset.childId,
  });
  // An owner may see another caregiver's attachment but does not finish their upload.
  if (asset.uploadedByUserId !== input.actorUserId) {
    throw ApiHttpError.notFound("That attachment is not available");
  }
  return asset;
}

/**
 * The stored object decides, not the request body: a missing object, a size over the product
 * limit, or a size the client did not report are all refused before any state moves. The key is
 * the asset's own, which the server generated, so there is no path for a client to substitute.
 */
async function assertStoredObjectMatches(
  deps: ServiceDeps,
  asset: MediaAssetRow,
  input: CompleteUploadRequest,
): Promise<void> {
  const storage = requireStorage(deps.storage);
  const limits = attachmentLimitsForAsset(asset.kind);
  const head = await storage.headObject(asset.objectKey);
  if (head === null) {
    throw ApiHttpError.validationFailed("That attachment has not finished uploading", {
      sizeBytes: ["No stored file was found for this attachment"],
    });
  }
  if (head.sizeBytes > limits.maxBytes) {
    throw ApiHttpError.validationFailed("That attachment is larger than the limit", {
      sizeBytes: [limits.sizeMessage],
    });
  }
  if (head.sizeBytes !== input.sizeBytes) {
    throw ApiHttpError.validationFailed("That attachment did not upload completely", {
      sizeBytes: ["The stored file does not match the reported size"],
    });
  }
}
