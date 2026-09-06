export type HandoffCardProps = {
  childName: string;
  /** Unacknowledged published changes for the caller. Zero switches to the quiet variant. */
  unreadCount: number;
  /** One factual line, already rendered by the caller. Null when there is nothing to preview. */
  previewText: string | null;
  onOpen: () => void;
  className?: string;
  testID?: string;
};
