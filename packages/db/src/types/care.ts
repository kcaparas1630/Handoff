import type { BriefStatus, CareEndReason } from "./enums";

export interface CareSessionRow {
  id: string;
  workspaceId: string;
  childId: string;
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
  endReason: CareEndReason | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface StartCareSession {
  id: string;
  workspaceId: string;
  childId: string;
  userId: string;
}

/** `created` distinguishes a new session from the double-tap that found the open one. */
export interface StartedCareSession {
  session: CareSessionRow;
  created: boolean;
}

export interface HandoffCursorRow {
  workspaceId: string;
  childId: string;
  userId: string;
  acknowledgedSeq: number;
  lastAcknowledgedBriefId: string | null;
  updatedAt: Date;
}

export interface AdvanceCursor {
  workspaceId: string;
  childId: string;
  userId: string;
  acknowledgedSeq: number;
  briefId: string;
}

export interface HandoffBriefRow {
  id: string;
  workspaceId: string;
  childId: string;
  recipientUserId: string;
  fromSeqExclusive: number;
  throughSeqInclusive: number;
  initialWindowStart: Date | null;
  // Displayed entries, source revision ids, and context labels as a ciphertext envelope.
  snapshotCiphertext: unknown;
  rendererVersion: string;
  status: BriefStatus;
  acknowledgedAt: Date | null;
  startedSessionId: string | null;
  createdAt: Date;
}

export interface NewHandoffBrief {
  id: string;
  workspaceId: string;
  childId: string;
  recipientUserId: string;
  fromSeqExclusive: number;
  throughSeqInclusive: number;
  initialWindowStart?: Date | null;
  snapshotCiphertext: unknown;
  rendererVersion: string;
}

/** What the dashboard needs before deciding what to render, in one authorized read. */
export interface OverviewMetadata {
  journalSeq: number;
  acknowledgedSeq: number;
  pendingCaptureCount: number;
  activeSessions: CareSessionRow[];
}
