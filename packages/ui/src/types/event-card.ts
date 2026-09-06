export type EventCardKind = "feed" | "diaper" | "sleep" | "milestone" | "note";

/** Matches the revision that produced this projection: a correction or a deletion. */
export type EventCardTag = "updated" | "removed";

export type EventCardProps = {
  kind: EventCardKind;
  /** The rendered fact. The card never derives text from raw fields. */
  factText: string;
  /** One line covering occurrence and report time, already worded by the caller. */
  timeLine: string;
  authorLabel: string;
  tag?: EventCardTag | undefined;
  isImportant?: boolean;
  onPress?: () => void;
  className?: string;
  testID?: string;
};
