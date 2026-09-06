import type { DraftCandidate, EventDto } from "@handoff/contracts";

import type { CaptureProgress } from "../lib/describe-capture-status";

export type CaptureProgressStepsProps = {
  progress: CaptureProgress;
};

export type DraftCandidateRowProps = {
  candidate: DraftCandidate;
  /** When the recording was made; the day chips are offered relative to it. */
  capturedAt: Date;
  timezone: string;
  onChange: (candidate: DraftCandidate) => void;
  onEdit: () => void;
  testID?: string;
};

export type EditCandidateSheetProps = {
  candidate: DraftCandidate;
  timezone: string;
  onSave: (candidate: DraftCandidate) => void;
  onClose: () => void;
};

export type TranscriptSectionProps = {
  /** The words as spoken. Kept available but never allowed to dominate the review screen. */
  rawTranscript: string | null;
  formattedText: string | null;
};

export type CaptureFailureActionsProps = {
  message: string;
  canRetry: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onEnterManually: () => void;
};

export type SavedCaptureTransitionProps = {
  /** The events the confirmation published; they are already in the journal. */
  events: readonly EventDto[];
  captureId: string | null;
  childId: string | null;
  workspaceId: string | null;
  onDone: () => void;
};
