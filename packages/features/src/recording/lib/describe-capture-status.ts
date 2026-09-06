import type { CaptureStatus } from "@handoff/contracts";
import type { OutboxStage } from "@handoff/mobile";
import type { StatusTone } from "@handoff/ui";

export type CaptureStepKey = "saved" | "uploading" | "preparing" | "ready";
export type CaptureStepState = "done" | "current" | "pending";
export type CaptureStep = { key: CaptureStepKey; label: string; state: CaptureStepState };

export type CaptureProgress = {
  headline: string;
  /** A second sentence when the plain label could still be misread; null when it cannot. */
  detail: string | null;
  steps: readonly CaptureStep[];
  tone: StatusTone;
  /** True once the capture needs the caregiver, is published, or has stopped. */
  isSettled: boolean;
  hasFailed: boolean;
};

export type DescribeCaptureStatusInput = {
  outboxStage: OutboxStage | null;
  captureStatus: CaptureStatus | null;
  /** The server DTO does not separate transcription from extraction; a transcript is the signal. */
  hasTranscript: boolean;
};

const stepLabels: Record<CaptureStepKey, string> = {
  saved: "Saved on this phone",
  uploading: "Uploading",
  preparing: "Preparing your update",
  ready: "Ready for review",
};

const stepOrder: readonly CaptureStepKey[] = ["saved", "uploading", "preparing", "ready"];

const stageIndexes: Record<OutboxStage, number> = {
  saved_locally: 0,
  capture_created: 0,
  uploaded: 1,
  completed: 2,
  failed: 0,
};

const statusIndexes: Record<CaptureStatus, number> = {
  awaiting_upload: 0,
  queued: 2,
  processing: 2,
  needs_review: 3,
  confirmed: 3,
  failed: 3,
  cancelled: 3,
};

/**
 * Turns the local stage and the server status into one truthful line. "Saved on this phone" is
 * never worded as shared, and the draft is never called ready before the server says so.
 */
export function describeCaptureStatus(input: DescribeCaptureStatusInput): CaptureProgress {
  const { outboxStage, captureStatus, hasTranscript } = input;

  if (outboxStage === "failed") {
    return progress(0, "This recording is still on this phone", {
      detail: "It could not be sent yet. Nothing has been shared.",
      tone: "error",
      hasFailed: true,
    });
  }
  if (captureStatus === "failed") {
    return progress(2, "This recording could not be turned into an update", {
      detail: "The recording is kept, so it can be tried again or entered by hand.",
      tone: "error",
      hasFailed: true,
    });
  }
  if (captureStatus === "cancelled") {
    return progress(3, "This recording was cancelled", {
      detail: "Nothing from it was saved to the journal.",
      tone: "warning",
      isSettled: true,
    });
  }

  // The server may answer from a moment before the last local step; the further one wins.
  const reached = Math.max(
    outboxStage === null ? -1 : stageIndexes[outboxStage],
    captureStatus === null ? -1 : statusIndexes[captureStatus],
  );

  if (reached <= 0) {
    return progress(0, stepLabels.saved, {
      detail: "Not shared yet. It uploads by itself when there is a connection.",
    });
  }
  if (reached === 1) return progress(1, stepLabels.uploading, { detail: null });
  if (reached === 2) {
    return hasTranscript && captureStatus === "processing"
      ? progress(2, "Transcribed, preparing draft", { detail: null })
      : progress(2, stepLabels.preparing, { detail: null });
  }
  if (captureStatus === "confirmed") {
    return progress(3, "Saved to the journal", {
      detail: null,
      tone: "success",
      isSettled: true,
    });
  }
  return progress(3, stepLabels.ready, {
    detail: "Nothing is saved until you tap Save.",
    tone: "success",
    isSettled: true,
  });
}

function progress(
  reached: number,
  headline: string,
  options: {
    detail?: string | null;
    tone?: StatusTone;
    isSettled?: boolean;
    hasFailed?: boolean;
  },
): CaptureProgress {
  return {
    headline,
    detail: options.detail ?? null,
    steps: stepOrder.map((key, index) => ({
      key,
      label: stepLabels[key],
      state: stepState(index, reached),
    })),
    tone: options.tone ?? "info",
    isSettled: options.isSettled ?? false,
    hasFailed: options.hasFailed ?? false,
  };
}

function stepState(index: number, reached: number): CaptureStepState {
  if (index < reached) return "done";
  return index === reached ? "current" : "pending";
}
