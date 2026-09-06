import type { AUDIO_MIME_TYPES } from "@handoff/contracts";

export type AudioMimeType = (typeof AUDIO_MIME_TYPES)[number];

export type RecorderStatus =
  "idle" | "requesting-permission" | "permission-denied" | "recording" | "stopping" | "saved";

/** What the microphone permission is before the recorder asks for it. */
export type MicrophonePermission = "unknown" | "undetermined" | "granted" | "denied";

/** A stopped recording that already lives in app document storage, not the cache. */
export type SavedRecording = {
  /** `file://` URI under `recordings/<captureLocalId>.<ext>` in the document directory. */
  uri: string;
  durationMs: number;
  mime: AudioMimeType;
  sizeBytes: number;
};

/** Why a recording ended without the caregiver tapping Stop. */
export type RecordingEndReason = "stopped" | "limit-reached" | "interrupted";

export type UseVoiceRecorderOptions = {
  /**
   * Product limit from architecture.md section 6, supplied by the caller so this package never
   * imports a contract value at runtime. The recorder stops itself when the limit is reached.
   */
  maxDurationMs: number;
  onLimitReached?: () => void;
};

export type VoiceRecorder = {
  status: RecorderStatus;
  permission: MicrophonePermission;
  elapsedMs: number;
  /** Normalised 0–1 loudness, or null when the platform reports no metering. */
  meteringLevel: number | null;
  /** The stopped file, whether the caregiver stopped it, the limit hit, or a call interrupted. */
  saved: SavedRecording | null;
  endReason: RecordingEndReason | null;
  /** One readable sentence when the recorder itself failed; never a provider object. */
  errorMessage: string | null;
  /** Only ever called from an explicit press. Nothing starts a recording on mount. */
  start: (captureLocalId: string) => Promise<void>;
  stop: () => Promise<SavedRecording | null>;
  cancel: () => Promise<void>;
};
