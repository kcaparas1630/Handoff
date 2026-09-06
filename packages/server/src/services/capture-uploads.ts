// Allocating and re-signing the recording upload. Split from captures.ts because the quota
// reservation, the object key, and the upload authorization are one concern with three callers:
// creating an audio capture, re-reading one that is still awaiting its upload, and completing it.
import { randomUUID } from "node:crypto";
import { AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_MS, AUDIO_MIME_TYPES } from "@handoff/contracts";
import { mediaRepository, storageQuotaRepository } from "@handoff/db";
import type { CreateCaptureAudio, UploadAuthorization } from "@handoff/contracts";
import type { HandoffTransaction, MediaAssetRow } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { buildObjectKey } from "../lib/object-key";
import type { ObjectStorage } from "../storage/object-storage";

/**
 * Long enough for a phone on a slow connection to finish a 10 MB upload without asking for a new
 * authorization; the asset row's own 24-hour expiry is what bounds an abandoned allocation.
 */
export const UPLOAD_AUTHORIZATION_SECONDS = 900;

/** An unfinished upload's object and reservation are purged after this (architecture §6). */
const PENDING_ASSET_HOURS = 24;

export function assertAudioIsAllowed(audio: CreateCaptureAudio): void {
  const fieldErrors: Record<string, string[]> = {};
  if (!AUDIO_MIME_TYPES.includes(audio.declaredMime)) {
    fieldErrors["audio.declaredMime"] = ["That recording format is not supported"];
  }
  if (audio.declaredSizeBytes > AUDIO_MAX_BYTES) {
    fieldErrors["audio.declaredSizeBytes"] = ["A recording may be at most 10 MB"];
  }
  if (audio.declaredDurationMs > AUDIO_MAX_DURATION_MS) {
    fieldErrors["audio.declaredDurationMs"] = ["A recording may be at most 60 seconds"];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw ApiHttpError.validationFailed("That recording cannot be uploaded", fieldErrors);
  }
}

/** The one place a capture's recording is found; a capture has at most one audio asset. */
export async function findAudioAsset(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; captureId: string },
): Promise<MediaAssetRow | null> {
  const assets = await mediaRepository.listAssetsForCapture(tx, input);
  return assets.find((asset) => asset.kind === "audio") ?? null;
}

/**
 * Reserves the bytes and records the allocation, in the caller's tenant transaction. The
 * reservation comes first: no upload token is issued for a workspace already at its budget, and
 * the provider is not called at all in that case (data contract §3).
 */
export async function allocateAudioAsset(
  tx: HandoffTransaction,
  input: {
    storage: ObjectStorage;
    workspaceId: string;
    childId: string;
    captureId: string;
    uploadedByUserId: string;
    audio: CreateCaptureAudio;
    now: Date;
  },
): Promise<MediaAssetRow> {
  const reserved = await storageQuotaRepository.reserveStorageBytes(tx, {
    workspaceId: input.workspaceId,
    bytes: input.audio.declaredSizeBytes,
  });
  if (reserved === null) {
    throw ApiHttpError.validationFailed("This workspace has no storage left for a recording", {
      storage: ["Workspace storage budget exceeded"],
    });
  }

  const assetId = randomUUID();
  return mediaRepository.insertMediaAsset(tx, {
    id: assetId,
    workspaceId: input.workspaceId,
    childId: input.childId,
    captureId: input.captureId,
    uploadedByUserId: input.uploadedByUserId,
    kind: "audio",
    storageProvider: input.storage.provider,
    bucket: input.storage.bucket,
    objectKey: buildObjectKey({
      workspaceId: input.workspaceId,
      childId: input.childId,
      captureId: input.captureId,
      assetId,
      mime: input.audio.declaredMime,
    }),
    declaredMime: input.audio.declaredMime,
    reservedBytes: input.audio.declaredSizeBytes,
    expiresAt: new Date(input.now.getTime() + PENDING_ASSET_HOURS * 60 * 60 * 1000),
  });
}

/**
 * Signed after the transaction commits, never inside it, and never stored: the asset row is the
 * source of truth, and an authorized re-read gets a fresh authorization instead of a replay.
 */
export async function authorizeAudioUpload(
  storage: ObjectStorage,
  asset: MediaAssetRow,
): Promise<UploadAuthorization> {
  const authorization = await storage.createUploadAuthorization({
    objectKey: asset.objectKey,
    contentType: asset.declaredMime,
    maxBytes: AUDIO_MAX_BYTES,
    expiresInSeconds: UPLOAD_AUTHORIZATION_SECONDS,
  });
  return {
    assetId: asset.id,
    method: "PUT",
    url: authorization.url,
    headers: authorization.headers,
    expiresAt: authorization.expiresAt.toISOString(),
    maxBytes: AUDIO_MAX_BYTES,
  };
}

/** The API can allocate an upload only when storage is configured (503, not a silent skip). */
export function requireStorage(storage: ObjectStorage | null): ObjectStorage {
  if (storage === null) {
    throw ApiHttpError.providerUnavailable("Recording storage is not available right now");
  }
  return storage;
}
