export type CareSnapshotKind = "feed" | "sleep" | "diaper";

export type CareSnapshotTile = {
  kind: CareSnapshotKind;
  /** The recorded fact, already rendered by the caller. Null when nothing is recorded yet. */
  factText: string | null;
  /** How long ago it happened, e.g. "2 h ago". Null when the occurrence time was never stated. */
  timeLabel: string | null;
  /** Opens the source event. Omitted when there is no recorded fact to open. */
  onPress?: () => void;
};

export type CareSnapshotProps = {
  tiles: readonly CareSnapshotTile[];
  className?: string;
  testID?: string;
};
