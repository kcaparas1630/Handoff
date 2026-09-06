export type ChoiceOption<Value extends string> = {
  value: Value;
  label: string;
};

export type ChoiceChipsProps<Value extends string> = {
  label: string;
  options: readonly ChoiceOption<Value>[];
  /** Values currently chosen; single-choice callers pass at most one. */
  selectedValues: readonly string[];
  onSelect: (value: Value) => void;
  /** Shown instead of the chips when there is nothing to choose from yet. */
  emptyMessage?: string;
  testID?: string;
};
