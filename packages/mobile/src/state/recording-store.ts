import { create } from "zustand";

import type { RecordingState } from "../types/recording-store";

/**
 * Recording controls and review selection only (architecture.md section 7). The audio file and
 * its upload attempts live in SQLite; nothing here survives sign-out.
 */
export const useRecordingStore = create<RecordingState>()((set) => ({
  activeRecording: null,
  reviewCaptureId: null,
  syncRequestedAt: 0,

  startRecording: (recording) => set({ activeRecording: recording }),

  clearActiveRecording: () => set({ activeRecording: null }),

  setReviewCaptureId: (captureId) => set({ reviewCaptureId: captureId }),

  requestOutboxSync: () => set({ syncRequestedAt: Date.now() }),

  resetRecordingState: () =>
    set({ activeRecording: null, reviewCaptureId: null, syncRequestedAt: 0 }),
}));
