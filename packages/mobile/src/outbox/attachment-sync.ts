import { completeAssetUpload, createAssetUpload, isApiClientError } from "@handoff/api-client";
import type { ApiClient } from "@handoff/api-client";
import type { UploadAuthorization } from "@handoff/contracts";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  advanceAttachmentStage,
  deleteOutboxAttachment,
  listPendingAttachmentsForUser,
  markAttachmentFailed,
} from "./attachment-database";
import { isAttemptDue, planRetry } from "./lib/retry-schedule";
import { uploadToSignedUrl } from "./upload";
import type { AttachmentStage, OutboxAttachment } from "./types/attachment";

/**
 * Walks every queued attachment through `saved_locally → asset_created → uploaded → completed`.
 * Each transition is committed before the next request runs, so the app can be killed at any point
 * and resume without repeating an effect.
 *
 * Unlike a recording, an attachment has no way to be re-signed: the API returns an upload
 * authorization from `POST /captures/:captureId/assets` and nowhere else. Replaying that call with
 * the same idempotency key returns the same stored authorization, which recovers a dropped
 * connection inside the original window. Once the authorization has expired there is nothing left
 * to resume, so the row is marked `failed`; the visible "Try again" starts over with a brand new
 * asset, and the abandoned pending one is purged server-side after 24 hours.
 */
export type SyncAttachmentsInput = {
  db: SQLiteDatabase;
  client: ApiClient;
  clerkUserId: string;
  now?: Date;
};

export type SyncAttachmentsResult = { advanced: number; deferred: number; failed: number };

export const ATTACHMENT_AUTHORIZATION_EXPIRED = "attachment_authorization_expired";

class AttachmentStepError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AttachmentStepError";
  }
}

export async function syncAttachments({
  db,
  client,
  clerkUserId,
  now = new Date(),
}: SyncAttachmentsInput): Promise<SyncAttachmentsResult> {
  const result: SyncAttachmentsResult = { advanced: 0, deferred: 0, failed: 0 };
  const rows = await listPendingAttachmentsForUser(db, clerkUserId);

  for (const row of rows) {
    // Defensive: the query is already scoped, and another account's file is never uploaded.
    if (row.clerkUserId !== clerkUserId) continue;
    if (!isAttemptDue(row.nextAttemptAt, now)) {
      result.deferred += 1;
      continue;
    }
    // Where the row got to before the step failed, so a retry never repeats a committed transition.
    let reachedStage = row.stage;
    try {
      await processAttachment(db, client, row, (stage) => {
        reachedStage = stage;
      });
      result.advanced += 1;
    } catch (error) {
      const errorCode = errorCodeOf(error);
      const plan = planRetry({ errorCode, previousAttempts: row.attempts, now });
      // An expired authorization cannot improve by waiting; it needs a new asset entirely.
      const isTerminal = plan.isTerminal || errorCode === ATTACHMENT_AUTHORIZATION_EXPIRED;
      await markAttachmentFailed(db, row.localId, {
        stage: isTerminal ? "failed" : reachedStage,
        errorCode,
        attempts: plan.attempts,
        nextAttemptAt: isTerminal ? null : plan.nextAttemptAt,
      });
      result.failed += 1;
    }
  }
  return result;
}

async function processAttachment(
  db: SQLiteDatabase,
  client: ApiClient,
  row: OutboxAttachment,
  onStageCommitted: (stage: AttachmentStage) => void,
): Promise<void> {
  let current = row;
  let authorization: UploadAuthorization | null = null;

  // At most one pass per stage; the loop bound keeps a server that never settles from spinning.
  for (let step = 0; step < 4; step += 1) {
    if (current.stage === "saved_locally") {
      const created = await allocateAsset(client, current);
      authorization = created.upload;
      await advanceAttachmentStage(db, current.localId, {
        stage: "asset_created",
        assetId: created.asset.id,
      });
      onStageCommitted("asset_created");
      current = { ...current, stage: "asset_created", assetId: created.asset.id };
      continue;
    }

    if (current.stage === "asset_created") {
      // A resumed row holds no authorization, so the create call is replayed under the same key.
      const usable = authorization ?? (await allocateAsset(client, current)).upload;
      authorization = null;
      if (Date.parse(usable.expiresAt) <= Date.now()) {
        throw new AttachmentStepError(ATTACHMENT_AUTHORIZATION_EXPIRED);
      }
      await sendAttachment(usable, current);
      await advanceAttachmentStage(db, current.localId, {
        stage: "uploaded",
        assetId: usable.assetId,
      });
      onStageCommitted("uploaded");
      current = { ...current, stage: "uploaded", assetId: usable.assetId };
      continue;
    }

    if (current.stage === "uploaded") {
      await reportCompletion(client, current);
      await advanceAttachmentStage(db, current.localId, { stage: "completed" });
      onStageCommitted("completed");
      current = { ...current, stage: "completed" };
      continue;
    }

    if (current.stage === "completed") {
      // Validation is the server's job from here; the event's readyAssetIds reveal the result.
      await deleteOutboxAttachment(db, current.localId);
      return;
    }
    return;
  }
}

function allocateAsset(client: ApiClient, row: OutboxAttachment) {
  return createAssetUpload(
    client,
    row.captureId,
    {
      kind: row.kind,
      declaredMime: row.mime,
      declaredSizeBytes: row.sizeBytes,
      ...(row.durationMs === null ? {} : { declaredDurationMs: row.durationMs }),
    },
    // The row id doubles as the idempotency key, so a replay returns the same allocated asset.
    row.localId,
  );
}

async function sendAttachment(
  authorization: UploadAuthorization,
  row: OutboxAttachment,
): Promise<void> {
  const { status } = await uploadToSignedUrl({
    url: authorization.url,
    headers: authorization.headers,
    fileUri: row.fileUri,
  });
  // A conflict means the allocated object is already stored, which is the outcome we wanted.
  if (status === 409 || (status >= 200 && status < 300)) return;
  if (status === 401 || status === 403) {
    throw new AttachmentStepError(ATTACHMENT_AUTHORIZATION_EXPIRED);
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    throw new AttachmentStepError("validation_failed");
  }
  throw new AttachmentStepError(`upload_status_${status}`);
}

function reportCompletion(client: ApiClient, row: OutboxAttachment): Promise<unknown> {
  const assetId = row.assetId;
  if (assetId === null) throw new AttachmentStepError("validation_failed");
  return completeAssetUpload(
    client,
    assetId,
    {
      sizeBytes: row.sizeBytes,
      ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    },
    // A stable key so a repeated completion replays the stored response instead of re-enqueuing.
    row.localId,
  );
}

function errorCodeOf(error: unknown): string {
  if (error instanceof AttachmentStepError) return error.code;
  if (isApiClientError(error)) return error.code;
  return "unknown";
}
