// Provider composition, secure token storage, device audio, the durable upload outbox, and the
// small selection/recording stores for both app flavors.

export { secureTokenCache } from "./auth/token-cache";
export { MobileProviders } from "./providers";
export { useSelectedContext } from "./state/context-store";
export { useRecordingStore } from "./state/recording-store";

export { useVoiceRecorder } from "./audio/recorder";
export { deleteRecordingFile } from "./audio/recording-storage";
export { normaliseMeteringLevel } from "./audio/lib/metering-level";
export { isSupportedAudioMime, recordingMimeForUri } from "./audio/lib/recording-mime";

export {
  advanceStage,
  deleteAllForUser,
  deleteOutboxCapture,
  findOutboxCapture,
  insertOutboxCapture,
  listAllForUser,
  listPendingForUser,
  markFailed,
  openOutbox,
  retryOutboxCapture,
} from "./outbox/database";
export { syncOutbox } from "./outbox/sync";
export { uploadToSignedUrl } from "./outbox/upload";
export { useOutboxSync } from "./outbox/useOutboxSync";
export { useOutboxCapture, useOutboxCaptures } from "./outbox/useOutboxCaptures";
export { useEnqueueRecording } from "./outbox/useEnqueueRecording";
export {
  MAX_AUTOMATIC_ATTEMPTS,
  isAttemptDue,
  isTerminalUploadError,
  planRetry,
  retryDelayMs,
} from "./outbox/lib/retry-schedule";

export type { SelectedContextState } from "./types/context-store";
export type { ActiveRecording, RecordingState } from "./types/recording-store";
export type { MobileProvidersProps } from "./types/providers";
export type {
  AudioMimeType,
  MicrophonePermission,
  RecorderStatus,
  RecordingEndReason,
  SavedRecording,
  UseVoiceRecorderOptions,
  VoiceRecorder,
} from "./audio/types/recorder";
export type {
  InsertOutboxCapture,
  OutboxCapture,
  OutboxFailure,
  OutboxStage,
  OutboxStagePatch,
} from "./outbox/types/outbox";
export type { SyncOutboxInput, SyncOutboxResult } from "./outbox/sync";
export type { EnqueueRecordingInput } from "./outbox/useEnqueueRecording";
export type { SignedUploadRequest, SignedUploadResult } from "./outbox/upload";
