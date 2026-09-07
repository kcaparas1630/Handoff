import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { captures, mediaAssets } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type { MediaKind } from "../types/enums";
import type {
  MediaAssetLookup,
  MediaAssetReady,
  MediaAssetRow,
  MediaUploadResult,
  NewMediaAsset,
} from "../types/media";

// Media rows move pending_upload -> uploaded -> ready, with rejected, deleting, and deleted
// branches. Every transition names the status it is coming from, so a replayed worker attempt
// matches no row and returns null instead of moving the same asset twice.

/** Call inside the same transaction as reserveStorageBytes: the row records what was reserved. */
export async function insertMediaAsset(
  tx: HandoffTransaction,
  input: NewMediaAsset,
): Promise<MediaAssetRow> {
  const [row] = await tx
    .insert(mediaAssets)
    .values({ ...input, status: "pending_upload" })
    .returning();
  if (!row) throw new Error("media asset insert returned no row");
  return row;
}

export async function findMediaAssetInWorkspace(
  tx: HandoffTransaction,
  workspaceId: string,
  assetId: string,
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.workspaceId, workspaceId), eq(mediaAssets.id, assetId)))
    .limit(1);
  return row ?? null;
}

/** Reconciles an object the storage provider reports against the allocation that created it. */
export async function findMediaAssetByObjectKey(
  tx: HandoffTransaction,
  lookup: MediaAssetLookup,
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.storageProvider, lookup.storageProvider),
        eq(mediaAssets.bucket, lookup.bucket),
        eq(mediaAssets.objectKey, lookup.objectKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listAssetsForCapture(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; captureId: string },
): Promise<MediaAssetRow[]> {
  return tx
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.childId, input.childId),
        eq(mediaAssets.captureId, input.captureId),
      ),
    )
    .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id));
}

/**
 * Enforces the per-capture attachment limit before another allocation is issued. A rejected or
 * deleted upload does not occupy a slot: the caregiver may try that attachment again.
 */
export async function countAssetsForCapture(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; captureId: string; kinds?: readonly MediaKind[] },
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.childId, input.childId),
        eq(mediaAssets.captureId, input.captureId),
        notInArray(mediaAssets.status, ["rejected", "deleted"]),
        input.kinds === undefined ? undefined : inArray(mediaAssets.kind, [...input.kinds]),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Records the completion callback. The version predicate rejects a stale caller that reports a
 * size for an allocation another request already completed.
 */
export async function markAssetUploaded(
  tx: HandoffTransaction,
  input: MediaUploadResult,
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .update(mediaAssets)
    .set({
      status: "uploaded",
      sizeBytes: input.sizeBytes,
      checksum: input.checksum ?? null,
      durationMs: input.durationMs ?? null,
      updatedAt: sql`now()`,
      version: sql`${mediaAssets.version} + 1`,
    })
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.id, input.assetId),
        eq(mediaAssets.status, "pending_upload"),
        eq(mediaAssets.version, input.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Publishes an asset after byte inspection. The cleanup_state predicate is what makes this row
 * the licence to settle the reservation: it can only be crossed once.
 *
 * A normalized image is written to a new object before this runs, so the key, size, and duration
 * the worker verified replace what the client declared. `expectedVersion` lets the worker refuse
 * to publish a row another attempt has touched since it read the bytes.
 */
export async function markAssetReady(
  tx: HandoffTransaction,
  input: MediaAssetReady,
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .update(mediaAssets)
    .set({
      status: "ready",
      verifiedMime: input.verifiedMime,
      cleanupState: "quota_released",
      ...(input.objectKey === undefined ? {} : { objectKey: input.objectKey }),
      ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      updatedAt: sql`now()`,
      version: sql`${mediaAssets.version} + 1`,
    })
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.id, input.assetId),
        eq(mediaAssets.status, "uploaded"),
        eq(mediaAssets.cleanupState, "none"),
        input.expectedVersion === undefined
          ? undefined
          : eq(mediaAssets.version, input.expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}

/** Validation failure. The object still exists; cleanup deletes it and releases the reservation. */
export async function markAssetRejected(
  tx: HandoffTransaction,
  input: { workspaceId: string; assetId: string },
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .update(mediaAssets)
    .set({
      status: "rejected",
      updatedAt: sql`now()`,
      version: sql`${mediaAssets.version} + 1`,
    })
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.id, input.assetId),
        inArray(mediaAssets.status, ["pending_upload", "uploaded"]),
      ),
    )
    .returning();
  return row ?? null;
}

/** Claims an asset for object deletion, so two cleanup attempts do not both call the provider. */
export async function markAssetDeleting(
  tx: HandoffTransaction,
  input: { workspaceId: string; assetId: string },
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .update(mediaAssets)
    .set({
      status: "deleting",
      updatedAt: sql`now()`,
      version: sql`${mediaAssets.version} + 1`,
    })
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.id, input.assetId),
        inArray(mediaAssets.status, ["pending_upload", "uploaded", "ready", "rejected"]),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Run after the storage object is gone. The status predicate is the replay guard; cleanup_state
 * keeps whichever marker is further along, so recording the object deletion cannot erase the
 * record that this asset's reservation already left storage_reserved_bytes.
 */
export async function markAssetDeleted(
  tx: HandoffTransaction,
  input: { workspaceId: string; assetId: string },
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .update(mediaAssets)
    .set({
      status: "deleted",
      cleanupState: sql`case when ${mediaAssets.cleanupState} = 'none' then 'object_deleted' else ${mediaAssets.cleanupState} end`,
      updatedAt: sql`now()`,
      version: sql`${mediaAssets.version} + 1`,
    })
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.id, input.assetId),
        eq(mediaAssets.status, "deleting"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * The licence to call releaseStorageBytes, in the same transaction. A second attempt matches no
 * row and returns null, so an interrupted cleanup that runs again cannot decrement twice.
 */
export async function markAssetQuotaReleased(
  tx: HandoffTransaction,
  input: { workspaceId: string; assetId: string },
): Promise<MediaAssetRow | null> {
  const [row] = await tx
    .update(mediaAssets)
    .set({
      cleanupState: "quota_released",
      updatedAt: sql`now()`,
      version: sql`${mediaAssets.version} + 1`,
    })
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.id, input.assetId),
        ne(mediaAssets.cleanupState, "quota_released"),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Abandoned uploads whose token has expired. Rows are tenant filtered by row-level security when
 * this runs as the API role; a cross-workspace sweep belongs to the maintenance capability.
 */
export async function listExpiredPendingAssets(
  tx: HandoffTransaction,
  now: Date,
  limit: number,
  kinds?: readonly MediaKind[],
): Promise<MediaAssetRow[]> {
  return tx
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.status, "pending_upload"),
        isNotNull(mediaAssets.expiresAt),
        lte(mediaAssets.expiresAt, now),
        kinds === undefined ? undefined : inArray(mediaAssets.kind, [...kinds]),
      ),
    )
    .orderBy(asc(mediaAssets.expiresAt), asc(mediaAssets.id))
    .limit(limit);
}

/**
 * Audio seconds this workspace has already sent to transcription since an instant. An allocation
 * that was never uploaded has no duration and therefore costs nothing; the caller adds the
 * duration the current request declares before comparing against the daily cap.
 */
export async function sumAudioDurationMsSince(
  tx: HandoffTransaction,
  input: { workspaceId: string; since: Date },
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${mediaAssets.durationMs}), 0)::bigint` })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.workspaceId, input.workspaceId),
        eq(mediaAssets.kind, "audio"),
        gte(mediaAssets.createdAt, input.since),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Every asset of one child, in creation order, for the purge's object-deletion stage. */
export async function listAssetsForChild(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; limit: number },
): Promise<MediaAssetRow[]> {
  return tx
    .select()
    .from(mediaAssets)
    .where(
      and(eq(mediaAssets.workspaceId, input.workspaceId), eq(mediaAssets.childId, input.childId)),
    )
    .orderBy(asc(mediaAssets.createdAt), asc(mediaAssets.id))
    .limit(input.limit);
}

/** Raw audio is source material: it is deleted a fixed interval after its capture is confirmed. */
export async function listAudioForCleanup(
  tx: HandoffTransaction,
  confirmedBefore: Date,
  limit: number,
): Promise<MediaAssetRow[]> {
  const rows = await tx
    .select({ asset: mediaAssets })
    .from(mediaAssets)
    .innerJoin(
      captures,
      and(
        eq(captures.workspaceId, mediaAssets.workspaceId),
        eq(captures.childId, mediaAssets.childId),
        eq(captures.id, mediaAssets.captureId),
      ),
    )
    .where(
      and(
        eq(mediaAssets.kind, "audio"),
        inArray(mediaAssets.status, ["uploaded", "ready"]),
        eq(captures.status, "confirmed"),
        isNotNull(captures.confirmedAt),
        lt(captures.confirmedAt, confirmedBefore),
      ),
    )
    .orderBy(asc(captures.confirmedAt), asc(mediaAssets.id))
    .limit(limit);
  return rows.map((row) => row.asset);
}
