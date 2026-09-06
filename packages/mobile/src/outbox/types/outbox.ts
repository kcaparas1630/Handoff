import type { AudioMimeType } from "../../audio/types/recorder";

/**
 * How far one recording has travelled. Each stage is a durable point the app can be killed at and
 * resumed from (implementation-roadmap.md milestone 3).
 */
export type OutboxStage = "saved_locally" | "capture_created" | "uploaded" | "completed" | "failed";

/** The stored row, already converted from the SQLite text/integer columns. */
export type OutboxCapture = {
  localId: string;
  /** Clerk user id. Rows are never processed for anyone but the currently signed-in account. */
  clerkUserId: string;
  workspaceId: string;
  childId: string;
  clientCaptureId: string;
  captureId: string | null;
  assetId: string | null;
  fileUri: string;
  mime: AudioMimeType;
  sizeBytes: number;
  durationMs: number;
  capturedAt: string;
  timezone: string;
  locale: string;
  careSessionId: string | null;
  stage: OutboxStage;
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsertOutboxCapture = {
  localId: string;
  clerkUserId: string;
  workspaceId: string;
  childId: string;
  clientCaptureId: string;
  fileUri: string;
  mime: AudioMimeType;
  sizeBytes: number;
  durationMs: number;
  capturedAt: string;
  timezone: string;
  locale: string;
  careSessionId?: string | null;
};

/** The fields one sync step is allowed to move forward. */
export type OutboxStagePatch = {
  stage: OutboxStage;
  captureId?: string | null;
  assetId?: string | null;
  attempts?: number;
  lastErrorCode?: string | null;
  nextAttemptAt?: string | null;
};

export type OutboxFailure = {
  errorCode: string;
  attempts: number;
  /** Null keeps the row visible for a manual retry instead of scheduling another attempt. */
  nextAttemptAt: string | null;
  /** Terminal failures stop automatic retries and ask the caregiver what to do. */
  isTerminal: boolean;
};
