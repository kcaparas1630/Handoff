export type QuickCareActionKind = "feed" | "diaper" | "sleep" | "note" | "milestone";

export type QuickCareActionsProps = {
  onSelect: (kind: QuickCareActionKind) => void;
  /** Comes straight from the caller's DTO permission; this component computes no authorization. */
  canContribute: boolean;
  /** Shown when the actions are disabled, so the reason is never left to the colour. */
  disabledReason?: string;
  className?: string;
  testID?: string;
};
