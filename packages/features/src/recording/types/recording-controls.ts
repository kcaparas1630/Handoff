export type RecordingControlsProps = {
  /** Kept visible so a recording cannot be attached to the wrong child. */
  childName: string;
  elapsedMs: number;
  maxDurationMs: number;
  /** Normalised 0–1 loudness, or null when the platform reports no metering. */
  meteringLevel: number | null;
  /** True while the file is being written; Stop must not be pressed twice. */
  isBusy: boolean;
  onStop: () => void;
  onCancel: () => void;
};
