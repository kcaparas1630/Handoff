import {
  completeUpload,
  createAudioCapture,
  getCapture,
  isApiClientError,
} from "@handoff/api-client";
import type { ApiClient } from "@handoff/api-client";
import type { CaptureDto, UploadAuthorization } from "@handoff/contracts";
import type { SQLiteDatabase } from "expo-sqlite";

import { recordClientMetric } from "../observability/metrics";
import { syncAttachments } from "./attachment-sync";
import { advanceStage, deleteOutboxCapture, listPendingForUser, markFailed } from "./database";
import { isAttemptDue, planRetry } from "./lib/retry-schedule";
import { uploadToSignedUrl } from "./upload";
import type { OutboxCapture } from "./types/outbox";

export type SyncOutboxInput = {
  db: SQLiteDatabase;
  client: ApiClient;
  /** Only this account's rows are touched; another account's recordings are never uploaded. */
  clerkUserId: string;
  now?: Date;
};

export type SyncOutboxResult = { advanced: number; deferred: number; failed: number };

// The upload is finished as far as the app is concerned once the server acknowledges the object.
const settledCaptureStatuses = ["needs_review", "confirmed", "failed", "cancelled"];

class UploadStepError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "UploadStepError";
  }
}

let inFlight: Promise<SyncOutboxResult> | null = null;

/**
 * Walks every pending recording through `saved_locally → capture_created → uploaded → completed`,
 * then does the same for queued attachments. Each transition is committed before the next request
 * runs, so the app can be killed at any point and resume without repeating an effect
 * (implementation-roadmap.md milestones 3 and 4).
 */
export function syncOutbox(input: SyncOutboxInput): Promise<SyncOutboxResult> {
  // Mount, foreground, and the interval can all fire at once; overlapping passes would retry the
  // same row twice, so concurrent callers share one run.
  inFlight ??= runSync(input).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync({
  db,
  client,
  clerkUserId,
  now = new Date(),
}: SyncOutboxInput): Promise<SyncOutboxResult> {
  const result: SyncOutboxResult = { advanced: 0, deferred: 0, failed: 0 };
  const rows = await listPendingForUser(db, clerkUserId);

  for (const row of rows) {
    // Defensive: the query is already scoped, and a row from another account is never processed.
    if (row.clerkUserId !== clerkUserId) continue;
    if (!isAttemptDue(row.nextAttemptAt, now)) {
      result.deferred += 1;
      continue;
    }
    try {
      await processRow(db, client, row);
      result.advanced += 1;
    } catch (error) {
      const plan = planRetry({
        errorCode: errorCodeOf(error),
        previousAttempts: row.attempts,
        now,
      });
      await markFailed(db, row.localId, {
        stage: plan.isTerminal ? "failed" : row.stage,
        errorCode: plan.errorCode,
        attempts: plan.attempts,
        nextAttemptAt: plan.nextAttemptAt,
      });
      result.failed += 1;
    }
  }

  // Attachments run after recordings: an attachment needs the capture its recording allocated.
  const attachments = await syncAttachments({ db, client, clerkUserId, now });
  result.advanced += attachments.advanced;
  result.deferred += attachments.deferred;
  result.failed += attachments.failed;

  return result;
}

async function processRow(
  db: SQLiteDatabase,
  client: ApiClient,
  row: OutboxCapture,
): Promise<void> {
  let current = row;
  let authorization: UploadAuthorization | null = null;

  // At most one pass per stage; the loop bound keeps a server that never settles from spinning.
  for (let step = 0; step < 4; step += 1) {
    if (current.stage === "saved_locally") {
      const capture = await createCapture(client, current);
      authorization = capture.upload ?? null;
      const assetId = capture.upload?.assetId ?? capture.audioAsset?.id ?? null;
      await advanceStage(db, current.localId, {
        stage: "capture_created",
        captureId: capture.id,
        assetId,
      });
      current = { ...current, stage: "capture_created", captureId: capture.id, assetId };
      continue;
    }

    if (current.stage === "capture_created") {
      const uploaded = await sendRecording(client, current, authorization);
      authorization = null;
      await advanceStage(db, current.localId, { stage: "uploaded", assetId: uploaded });
      current = { ...current, stage: "uploaded" };
      continue;
    }

    if (current.stage === "uploaded") {
      await reportCompletion(client, current);
      await advanceStage(db, current.localId, { stage: "completed" });
      // Counted once per recording: the stage transition commits before the next pass reads it.
      recordClientMetric("capture_uploaded", {
        durationMs: Date.now() - Date.parse(current.createdAt),
        status: "ok",
      });
      current = { ...current, stage: "completed" };
      continue;
    }

    if (current.stage === "completed") {
      await settleCompleted(db, client, current);
      return;
    }
    return;
  }
}

function createCapture(client: ApiClient, row: OutboxCapture): Promise<CaptureDto> {
  return createAudioCapture(client, {
    childId: row.childId,
    clientCaptureId: row.clientCaptureId,
    capturedAt: row.capturedAt,
    timezone: row.timezone,
    locale: row.locale,
    careSessionId: row.careSessionId ?? undefined,
    audio: {
      declaredMime: row.mime,
      declaredSizeBytes: row.sizeBytes,
      declaredDurationMs: row.durationMs,
    },
  });
}

/**
 * Uploads the bytes. A signed URL is never stored, so a resumed row asks the API for a fresh
 * authorization; an expired or already-used one is recovered the same way.
 */
async function sendRecording(
  client: ApiClient,
  row: OutboxCapture,
  held: UploadAuthorization | null,
): Promise<string | null> {
  const captureId = row.captureId;
  if (captureId === null) throw new UploadStepError("validation_failed");

  const usable = held !== null && Date.parse(held.expiresAt) > Date.now() ? held : null;
  if (usable === null) return putWithFreshAuthorization(client, captureId, row.fileUri);

  const status = await putRecording(usable, row.fileUri);
  // An expired or already-consumed authorization is recovered by asking the API for a new one.
  if (status === 401 || status === 403) {
    return putWithFreshAuthorization(client, captureId, row.fileUri);
  }
  return assetIdForStatus(status, usable.assetId);
}

async function putWithFreshAuthorization(
  client: ApiClient,
  captureId: string,
  fileUri: string,
): Promise<string | null> {
  const refreshed = await getCapture(client, captureId);
  // The server already holds the object: nothing is left to send for this row.
  if (refreshed.status !== "awaiting_upload") return refreshed.audioAsset?.id ?? null;
  const authorization = refreshed.upload;
  if (authorization === null || authorization === undefined) {
    throw new UploadStepError("upload_authorization_missing");
  }
  return assetIdForStatus(await putRecording(authorization, fileUri), authorization.assetId);
}

async function putRecording(authorization: UploadAuthorization, fileUri: string): Promise<number> {
  const { status } = await uploadToSignedUrl({
    url: authorization.url,
    headers: authorization.headers,
    fileUri,
  });
  return status;
}

function assetIdForStatus(status: number, assetId: string): string {
  // A conflict means the allocated object is already stored, which is the outcome we wanted.
  if (status === 409) return assetId;
  if (status >= 200 && status < 300) return assetId;
  if (status === 401 || status === 403) throw new UploadStepError("upload_not_authorized");
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    throw new UploadStepError("validation_failed");
  }
  throw new UploadStepError(`upload_status_${status}`);
}

function reportCompletion(client: ApiClient, row: OutboxCapture): Promise<unknown> {
  const captureId = row.captureId;
  if (captureId === null) throw new UploadStepError("validation_failed");
  return completeUpload(
    client,
    captureId,
    { sizeBytes: row.sizeBytes, durationMs: row.durationMs },
    // A stable UUID so a repeated completion replays the stored response instead of re-enqueuing.
    row.localId,
  );
}

/**
 * The server owns the recording from here. The row and its file stay until the capture reaches a
 * state the caregiver acts on, so the dashboard can still point at a recording being processed.
 */
async function settleCompleted(
  db: SQLiteDatabase,
  client: ApiClient,
  row: OutboxCapture,
): Promise<void> {
  const captureId = row.captureId;
  if (captureId === null) throw new UploadStepError("validation_failed");
  try {
    const capture = await getCapture(client, captureId);
    if (settledCaptureStatuses.includes(capture.status)) {
      await deleteOutboxCapture(db, row.localId);
    }
  } catch (error) {
    // A capture the server no longer has cannot be finished; the local copy is released.
    if (isApiClientError(error) && error.code === "not_found") {
      await deleteOutboxCapture(db, row.localId);
      return;
    }
    throw error;
  }
}

function errorCodeOf(error: unknown): string {
  if (error instanceof UploadStepError) return error.code;
  if (isApiClientError(error)) return error.code;
  return "unknown";
}
