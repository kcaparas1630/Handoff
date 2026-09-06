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
  AttachmentPermissionError,
  UnsupportedAttachmentError,
  pickAttachment,
} from "./media/picker";
export { prepareImageForUpload } from "./media/prepare-image";
export { deleteAttachmentFile, saveAttachmentFile } from "./media/attachment-storage";
export { describeAttachmentLimitProblem } from "./media/lib/attachment-file-limits";
export {
  attachmentExtensionForMime,
  attachmentExtensionForUri,
  attachmentMimeFor,
} from "./media/lib/attachment-mime";
export { MAX_IMAGE_EDGE, resizeTargetForImage } from "./media/lib/resize-target";

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
export {
  advanceAttachmentStage,
  deleteAllAttachmentsForUser,
  deleteOutboxAttachment,
  findOutboxAttachment,
  insertOutboxAttachment,
  listAttachmentsForUser,
  listPendingAttachmentsForUser,
  markAttachmentFailed,
  restartOutboxAttachment,
} from "./outbox/attachment-database";
export { syncOutbox } from "./outbox/sync";
export { ATTACHMENT_AUTHORIZATION_EXPIRED, syncAttachments } from "./outbox/attachment-sync";
export { describeAttachmentProgress, summariseAttachments } from "./outbox/lib/attachment-summary";
export { uploadToSignedUrl } from "./outbox/upload";
export { useOutboxSync } from "./outbox/useOutboxSync";
export { useOutboxCapture, useOutboxCaptures } from "./outbox/useOutboxCaptures";
export { useEnqueueRecording } from "./outbox/useEnqueueRecording";
export { useEnqueueAttachment } from "./outbox/useEnqueueAttachment";
export { useOutboxAttachments } from "./outbox/useOutboxAttachments";
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
export type { SyncAttachmentsInput, SyncAttachmentsResult } from "./outbox/attachment-sync";
export type {
  AttachmentStage,
  AttachmentStagePatch,
  InsertOutboxAttachment,
  OutboxAttachment,
  OutboxAttachmentSummary,
} from "./outbox/types/attachment";
export type {
  ExplainAttachmentPermission,
  PickAttachmentKind,
  PickAttachmentOptions,
  PickAttachmentSource,
  PickedAttachment,
  PreparedImage,
  StoredAttachmentFile,
} from "./media/types/attachment";
export type { EnqueueRecordingInput } from "./outbox/useEnqueueRecording";
export type { EnqueueAttachmentInput } from "./outbox/useEnqueueAttachment";
export type { UseOutboxAttachments } from "./outbox/useOutboxAttachments";
export type { SignedUploadRequest, SignedUploadResult } from "./outbox/upload";
