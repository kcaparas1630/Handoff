/** The recording currently being captured on this device, before any server record exists. */
export type ActiveRecording = {
  localId: string;
  childId: string;
};

export type RecordingState = {
  activeRecording: ActiveRecording | null;
  /** The capture the review screen is watching, so a return to the app reopens the same one. */
  reviewCaptureId: string | null;
  /** Bumped when something wants the upload outbox drained now; the sync hook watches it. */
  syncRequestedAt: number;
  startRecording: (recording: ActiveRecording) => void;
  clearActiveRecording: () => void;
  setReviewCaptureId: (captureId: string | null) => void;
  requestOutboxSync: () => void;
  /** Called on sign-out; the durable rows themselves are removed by the outbox, not by this. */
  resetRecordingState: () => void;
};
