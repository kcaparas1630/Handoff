export type LabeledTextInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Short explanation shown under the field, e.g. an accepted format. */
  hint?: string;
  keyboardType?: "default" | "email-address" | "number-pad" | "decimal-pad";
  autoCapitalize?: "none" | "words" | "sentences";
  autoComplete?: "email" | "one-time-code" | "off";
  /** Grows the field for a sentence or two; single-line stays the default. */
  isMultiline?: boolean;
  isEditable?: boolean;
  testID?: string;
};
