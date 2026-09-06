export type ButtonVariant = "primary" | "secondary" | "quiet";

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Defaults to `label`; set it when the visible label is not self-explanatory. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  isDisabled?: boolean;
  isLoading?: boolean;
  className?: string;
  testID?: string;
};
