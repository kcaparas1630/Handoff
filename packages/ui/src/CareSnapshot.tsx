import { Pressable, Text, View } from "react-native";

import type { CareSnapshotKind, CareSnapshotProps, CareSnapshotTile } from "./types/care-snapshot";

// Glyph plus the written label plus the state line; colour never carries the meaning on its own.
const tileGlyphs: Record<CareSnapshotKind, string> = {
  feed: "\u{1F37C}",
  sleep: "\u{1F319}",
  diaper: "\u{1F9F7}",
};

const tileLabels: Record<CareSnapshotKind, string> = {
  feed: "Feed",
  sleep: "Sleep",
  diaper: "Diaper",
};

const emptyText = "Not recorded yet";
const unknownTimeText = "time not given";

export function CareSnapshot({ tiles, className = "", testID }: CareSnapshotProps) {
  return (
    <View className={`flex-row gap-md ${className}`} testID={testID}>
      {tiles.map((tile) => (
        <SnapshotTile key={tile.kind} tile={tile} />
      ))}
    </View>
  );
}

function SnapshotTile({ tile }: { tile: CareSnapshotTile }) {
  const label = tileLabels[tile.kind];
  const timeText = tile.factText === null ? null : (tile.timeLabel ?? unknownTimeText);
  const spoken = [
    label,
    tile.factText ?? emptyText,
    timeText === null ? null : `recorded fact, ${timeText}`,
  ]
    .filter((part) => part !== null)
    .join(", ");

  const body = (
    <>
      <Text accessibilityElementsHidden importantForAccessibility="no" className="text-lg">
        {tileGlyphs[tile.kind]}
      </Text>
      <Text className="text-sm font-semibold text-primary dark:text-primary-dark">{label}</Text>
      <Text className="text-base text-primary dark:text-primary-dark">
        {tile.factText ?? emptyText}
      </Text>
      {timeText === null ? null : (
        <>
          <Text className="text-sm text-muted dark:text-muted-dark">{timeText}</Text>
          <Text className="text-xs text-muted dark:text-muted-dark">recorded fact</Text>
        </>
      )}
    </>
  );

  const tileClassName =
    "min-h-touch flex-1 gap-xs rounded-md border border-border bg-surface px-md py-md dark:border-border-dark dark:bg-surface-dark";

  if (tile.onPress === undefined) {
    return (
      <View accessible accessibilityLabel={spoken} className={tileClassName}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the entry this fact came from"
      onPress={tile.onPress}
      className={tileClassName}
      testID={`care-snapshot-${tile.kind}`}
    >
      {body}
    </Pressable>
  );
}
