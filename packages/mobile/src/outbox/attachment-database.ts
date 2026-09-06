import type { SQLiteDatabase } from "expo-sqlite";
import type { AttachmentKind } from "@handoff/contracts";

import { deleteAttachmentFile } from "../media/attachment-storage";
import type {
  AttachmentStage,
  AttachmentStagePatch,
  InsertOutboxAttachment,
  OutboxAttachment,
} from "./types/attachment";

// Stages the sync loop still has work for. `completed` stays until the row and file are released.
const pendingStages: readonly AttachmentStage[] = [
  "saved_locally",
  "asset_created",
  "uploaded",
  "completed",
];

type AttachmentRow = {
  local_id: string;
  clerk_user_id: string;
  workspace_id: string;
  child_id: string;
  capture_id: string;
  asset_id: string | null;
  kind: string;
  file_uri: string;
  mime: string;
  size_bytes: number;
  duration_ms: number | null;
  stage: string;
  attempts: number;
  last_error_code: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertOutboxAttachment(
  database: SQLiteDatabase,
  input: InsertOutboxAttachment,
): Promise<void> {
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO outbox_attachments (
       local_id, clerk_user_id, workspace_id, child_id, capture_id, asset_id, kind, file_uri,
       mime, size_bytes, duration_ms, stage, attempts, last_error_code, next_attempt_at,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'saved_locally', 0, NULL, NULL, ?, ?)`,
    [
      input.localId,
      input.clerkUserId,
      input.workspaceId,
      input.childId,
      input.captureId,
      input.kind,
      input.fileUri,
      input.mime,
      input.sizeBytes,
      input.durationMs ?? null,
      now,
      now,
    ],
  );
}

/** Rows the sync loop may act on, for this signed-in user only, oldest first. */
export async function listPendingAttachmentsForUser(
  database: SQLiteDatabase,
  clerkUserId: string,
): Promise<OutboxAttachment[]> {
  const placeholders = pendingStages.map(() => "?").join(", ");
  const rows = await database.getAllAsync<AttachmentRow>(
    `SELECT * FROM outbox_attachments
      WHERE clerk_user_id = ? AND stage IN (${placeholders})
      ORDER BY created_at ASC`,
    [clerkUserId, ...pendingStages],
  );
  return rows.map(toOutboxAttachment);
}

/** Every attachment this user owns, including failed ones a screen offers a retry for. */
export async function listAttachmentsForUser(
  database: SQLiteDatabase,
  clerkUserId: string,
): Promise<OutboxAttachment[]> {
  const rows = await database.getAllAsync<AttachmentRow>(
    "SELECT * FROM outbox_attachments WHERE clerk_user_id = ? ORDER BY created_at ASC",
    [clerkUserId],
  );
  return rows.map(toOutboxAttachment);
}

export async function findOutboxAttachment(
  database: SQLiteDatabase,
  localId: string,
): Promise<OutboxAttachment | null> {
  const row = await database.getFirstAsync<AttachmentRow>(
    "SELECT * FROM outbox_attachments WHERE local_id = ?",
    [localId],
  );
  return row === null ? null : toOutboxAttachment(row);
}

export async function advanceAttachmentStage(
  database: SQLiteDatabase,
  localId: string,
  patch: AttachmentStagePatch,
): Promise<void> {
  await database.runAsync(
    `UPDATE outbox_attachments SET
       stage = ?,
       asset_id = COALESCE(?, asset_id),
       attempts = COALESCE(?, attempts),
       last_error_code = ?,
       next_attempt_at = ?,
       updated_at = ?
     WHERE local_id = ?`,
    [
      patch.stage,
      patch.assetId ?? null,
      patch.attempts ?? null,
      patch.lastErrorCode ?? null,
      patch.nextAttemptAt ?? null,
      new Date().toISOString(),
      localId,
    ],
  );
}

export async function markAttachmentFailed(
  database: SQLiteDatabase,
  localId: string,
  failure: {
    stage: AttachmentStage;
    errorCode: string;
    attempts: number;
    nextAttemptAt: string | null;
  },
): Promise<void> {
  await database.runAsync(
    `UPDATE outbox_attachments SET
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
 * Queues a failed attachment again. The server exposes no way to re-sign an existing pending
 * asset, so a retry has to allocate a new one: the row is replaced by a fresh local id, which is
 * also the create idempotency key, while the prepared file stays exactly where it is. The
 * abandoned pending asset is purged server-side after 24 hours (architecture.md section 6).
 */
export async function restartOutboxAttachment(
  database: SQLiteDatabase,
  localId: string,
  nextLocalId: string,
): Promise<void> {
  const existing = await findOutboxAttachment(database, localId);
  if (existing === null || existing.stage !== "failed") return;
  await database.withTransactionAsync(async () => {
    await database.runAsync("DELETE FROM outbox_attachments WHERE local_id = ?", [localId]);
    await insertOutboxAttachment(database, {
      localId: nextLocalId,
      clerkUserId: existing.clerkUserId,
      workspaceId: existing.workspaceId,
      childId: existing.childId,
      captureId: existing.captureId,
      kind: existing.kind,
      fileUri: existing.fileUri,
      mime: existing.mime,
      sizeBytes: existing.sizeBytes,
      durationMs: existing.durationMs,
    });
  });
}

/** Removes the row and the prepared file; the server owns the bytes by this point. */
export async function deleteOutboxAttachment(
  database: SQLiteDatabase,
  localId: string,
): Promise<void> {
  const existing = await findOutboxAttachment(database, localId);
  if (existing !== null) deleteAttachmentFile(existing.fileUri);
  await database.runAsync("DELETE FROM outbox_attachments WHERE local_id = ?", [localId]);
}

/** Sign-out cleanup for this account's attachments. Returns how many rows were removed. */
export async function deleteAllAttachmentsForUser(
  database: SQLiteDatabase,
  clerkUserId: string,
): Promise<number> {
  const rows = await listAttachmentsForUser(database, clerkUserId);
  for (const row of rows) deleteAttachmentFile(row.fileUri);
  await database.runAsync("DELETE FROM outbox_attachments WHERE clerk_user_id = ?", [clerkUserId]);
  return rows.length;
}

function toOutboxAttachment(row: AttachmentRow): OutboxAttachment {
  return {
    localId: row.local_id,
    clerkUserId: row.clerk_user_id,
    workspaceId: row.workspace_id,
    childId: row.child_id,
    captureId: row.capture_id,
    assetId: row.asset_id,
    kind: row.kind as AttachmentKind,
    fileUri: row.file_uri,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    stage: row.stage as AttachmentStage,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
