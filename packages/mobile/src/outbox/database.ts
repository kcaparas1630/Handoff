import { openDatabaseAsync } from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import { deleteRecordingFile } from "../audio/recording-storage";
import { outboxSchemaSql } from "./schema";
import type {
  InsertOutboxCapture,
  OutboxCapture,
  OutboxStage,
  OutboxStagePatch,
} from "./types/outbox";
import type { AudioMimeType } from "../audio/types/recorder";

const databaseName = "handoff-outbox.db";

// Stages the sync loop still has work for; `completed` stays until the server capture is reviewed.
const pendingStages: readonly OutboxStage[] = [
  "saved_locally",
  "capture_created",
  "uploaded",
  "completed",
];

type OutboxRow = {
  local_id: string;
  clerk_user_id: string;
  workspace_id: string;
  child_id: string;
  client_capture_id: string;
  capture_id: string | null;
  asset_id: string | null;
  file_uri: string;
  mime: string;
  size_bytes: number;
  duration_ms: number;
  captured_at: string;
  timezone: string;
  locale: string;
  care_session_id: string | null;
  stage: string;
  attempts: number;
  last_error_code: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

let connection: Promise<SQLiteDatabase> | null = null;

/** One connection per app process. The schema is applied on first open. */
export function openOutbox(): Promise<SQLiteDatabase> {
  connection ??= openDatabaseAsync(databaseName).then(async (database) => {
    await database.execAsync(outboxSchemaSql);
    return database;
  });
  return connection;
}

export async function insertOutboxCapture(
  database: SQLiteDatabase,
  input: InsertOutboxCapture,
): Promise<void> {
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO outbox_captures (
       local_id, clerk_user_id, workspace_id, child_id, client_capture_id, capture_id, asset_id,
       file_uri, mime, size_bytes, duration_ms, captured_at, timezone, locale, care_session_id,
       stage, attempts, last_error_code, next_attempt_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'saved_locally', 0, NULL, NULL, ?, ?)`,
    [
      input.localId,
      input.clerkUserId,
      input.workspaceId,
      input.childId,
      input.clientCaptureId,
      input.fileUri,
      input.mime,
      input.sizeBytes,
      input.durationMs,
      input.capturedAt,
      input.timezone,
      input.locale,
      input.careSessionId ?? null,
      now,
      now,
    ],
  );
}

/** Rows the sync loop may act on, for this signed-in user only, oldest recording first. */
export async function listPendingForUser(
  database: SQLiteDatabase,
  clerkUserId: string,
): Promise<OutboxCapture[]> {
  const placeholders = pendingStages.map(() => "?").join(", ");
  const rows = await database.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox_captures
      WHERE clerk_user_id = ? AND stage IN (${placeholders})
      ORDER BY created_at ASC`,
    [clerkUserId, ...pendingStages],
  );
  return rows.map(toOutboxCapture);
}

/** Every row this user owns, including failed ones the review screen offers a retry for. */
export async function listAllForUser(
  database: SQLiteDatabase,
  clerkUserId: string,
): Promise<OutboxCapture[]> {
  const rows = await database.getAllAsync<OutboxRow>(
    "SELECT * FROM outbox_captures WHERE clerk_user_id = ? ORDER BY created_at ASC",
    [clerkUserId],
  );
  return rows.map(toOutboxCapture);
}

export async function findOutboxCapture(
  database: SQLiteDatabase,
  localId: string,
): Promise<OutboxCapture | null> {
  const row = await database.getFirstAsync<OutboxRow>(
    "SELECT * FROM outbox_captures WHERE local_id = ?",
    [localId],
  );
  return row === null ? null : toOutboxCapture(row);
}

export async function advanceStage(
  database: SQLiteDatabase,
  localId: string,
  patch: OutboxStagePatch,
): Promise<void> {
  await database.runAsync(
    `UPDATE outbox_captures SET
       stage = ?,
       capture_id = COALESCE(?, capture_id),
       asset_id = COALESCE(?, asset_id),
       attempts = COALESCE(?, attempts),
       last_error_code = ?,
       next_attempt_at = ?,
       updated_at = ?
     WHERE local_id = ?`,
    [
      patch.stage,
      patch.captureId ?? null,
      patch.assetId ?? null,
      patch.attempts ?? null,
      patch.lastErrorCode ?? null,
      patch.nextAttemptAt ?? null,
      new Date().toISOString(),
      localId,
    ],
  );
}

/**
 * Records an attempt that did not succeed. A row with a future `next_attempt_at` is retried
 * automatically; a `failed` stage waits for the caregiver.
 */
export async function markFailed(
  database: SQLiteDatabase,
  localId: string,
  failure: {
    stage: OutboxStage;
    errorCode: string;
    attempts: number;
    nextAttemptAt: string | null;
  },
): Promise<void> {
  await database.runAsync(
    `UPDATE outbox_captures SET
       stage = ?, attempts = ?, last_error_code = ?, next_attempt_at = ?, updated_at = ?
     WHERE local_id = ?`,
    [
      failure.stage,
      failure.attempts,
      failure.errorCode,
      failure.nextAttemptAt,
      new Date().toISOString(),
      localId,
    ],
  );
}

/**
 * Puts a failed row back in the queue after the caregiver asks for it. The resume point is derived
 * from what is already known: without a capture id nothing was allocated, and with one the upload
 * step is self-healing because it re-reads the capture before sending anything.
 */
export async function retryOutboxCapture(database: SQLiteDatabase, localId: string): Promise<void> {
  const existing = await findOutboxCapture(database, localId);
  if (existing === null || existing.stage !== "failed") return;
  await database.runAsync(
    `UPDATE outbox_captures SET
       stage = ?, attempts = 0, last_error_code = NULL, next_attempt_at = NULL, updated_at = ?
     WHERE local_id = ?`,
    [
      existing.captureId === null ? "saved_locally" : "capture_created",
      new Date().toISOString(),
      localId,
    ],
  );
}

/** Removes the row and the recording it points at; the server owns the audio by this point. */
export async function deleteOutboxCapture(
  database: SQLiteDatabase,
  localId: string,
): Promise<void> {
  const existing = await findOutboxCapture(database, localId);
  if (existing !== null) deleteRecordingFile(existing.fileUri);
  await database.runAsync("DELETE FROM outbox_captures WHERE local_id = ?", [localId]);
}

/**
 * Sign-out cleanup. architecture.md section 7: logout removes that user's local files and outbox
 * after a clear unsent-recordings notice.
 */
export async function deleteAllForUser(
  database: SQLiteDatabase,
  clerkUserId: string,
): Promise<number> {
  const rows = await listAllForUser(database, clerkUserId);
  for (const row of rows) deleteRecordingFile(row.fileUri);
  await database.runAsync("DELETE FROM outbox_captures WHERE clerk_user_id = ?", [clerkUserId]);
  return rows.length;
}

function toOutboxCapture(row: OutboxRow): OutboxCapture {
  return {
    localId: row.local_id,
    clerkUserId: row.clerk_user_id,
    workspaceId: row.workspace_id,
    childId: row.child_id,
    clientCaptureId: row.client_capture_id,
    captureId: row.capture_id,
    assetId: row.asset_id,
    fileUri: row.file_uri,
    mime: row.mime as AudioMimeType,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    capturedAt: row.captured_at,
    timezone: row.timezone,
    locale: row.locale,
    careSessionId: row.care_session_id,
    stage: row.stage as OutboxStage,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
