import type { AttachmentKind } from "@handoff/contracts";

/**
 * How far one attachment has travelled. Each stage is a durable point the app can be killed at and
 * resumed from; `completed` means the server acknowledged the object and only cleanup is left.
 */
export type AttachmentStage =
  "saved_locally" | "asset_created" | "uploaded" | "completed" | "failed";

/** The stored row, already converted from the SQLite text/integer columns. */
export type OutboxAttachment = {
  localId: string;
  /** Clerk user id. Rows are never processed for anyone but the currently signed-in account. */
  clerkUserId: string;
  workspaceId: string;
  childId: string;
  /** An attachment always rides on an existing capture, so this is never null. */
  captureId: string;
  assetId: string | null;
  kind: AttachmentKind;
  fileUri: string;
  mime: string;
  sizeBytes: number;
  /** Videos only; an image has no duration. */
  durationMs: number | null;
  stage: AttachmentStage;
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsertOutboxAttachment = {
  localId: string;
  clerkUserId: string;
  workspaceId: string;
  childId: string;
  captureId: string;
  kind: AttachmentKind;
  fileUri: string;
  mime: string;
  sizeBytes: number;
  durationMs?: number | null;
};

export type AttachmentStagePatch = {
  stage: AttachmentStage;
  assetId?: string | null;
  attempts?: number;
  lastErrorCode?: string | null;
  nextAttemptAt?: string | null;
};

/** What a screen needs to say honestly where each of this capture's attachments has reached. */
export type OutboxAttachmentSummary = {
  /** Files this account holds for the capture that the server has not acknowledged yet. */
  localCount: number;
  /** Still only on this phone. */
  savedLocallyCount: number;
  /** Handed to the server, waiting for validation to publish it. */
  awaitingValidationCount: number;
  failedCount: number;
};
