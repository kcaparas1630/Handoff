export type ChildCardBadge = {
  /** Rendered text, already formatted by the caller. No count is invented here. */
  text: string;
  /** Spoken description, e.g. "3 unread updates". */
  accessibilityLabel: string;
};

export type ChildCardProps = {
  name: string;
  /** Optional supporting line such as a workspace name or "Alex is caring". */
  secondaryLine?: string;
  badge?: ChildCardBadge;
  onPress: () => void;
  /** Defaults to the name plus secondary line; set it when more context is needed. */
  accessibilityLabel?: string;
  className?: string;
  testID?: string;
};
