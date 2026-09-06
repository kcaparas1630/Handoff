export type RecordButtonState = "idle" | "recording" | "disabled";

export type RecordButtonProps = {
  state: RecordButtonState;
  onPress: () => void;
  /** Defaults to "Record update"; the control is never an unexplained floating microphone. */
  label?: string | undefined;
  /** The short line under the control, for example a rotating example of what to say. */
  hintText?: string | undefined;
  /** Shown instead of the hint when the control is disabled, so the reason is never implied. */
  disabledReason?: string | undefined;
  /**
   * Decided by the screen from the platform setting. When true the recording pulse is dropped;
   * the state is still carried by the label and the glyph.
   */
  isReducedMotion?: boolean | undefined;
  className?: string | undefined;
  testID?: string | undefined;
};
