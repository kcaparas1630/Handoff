import { Pressable, Text, View } from "react-native";

import type { EventCardKind, EventCardProps, EventCardTag } from "./types/event-card";

const kindGlyphs: Record<EventCardKind, string> = {
  feed: "\u{1F37C}",
  diaper: "\u{1F9F7}",
  sleep: "\u{1F319}",
  milestone: "⭐",
  note: "\u{1F4DD}",
};

const kindLabels: Record<EventCardKind, string> = {
  feed: "Feed",
  diaper: "Diaper",
  sleep: "Sleep",
  milestone: "Milestone",
  note: "Note",
};

const tagLabels: Record<EventCardTag, string> = {
  updated: "Updated",
  removed: "Removed",
};

export function EventCard({
  kind,
  factText,
  timeLine,
  authorLabel,
  tag,
  isImportant = false,
  onPress,
  className = "",
  testID,
}: EventCardProps) {
  const spoken = [
    kindLabels[kind],
    isImportant ? "marked important" : null,
    tag === undefined ? null : tagLabels[tag],
    factText,
    timeLine,
    authorLabel,
  ]
    .filter((part) => part !== null)
    .join(", ");

  const body = (
    <>
      <View className="flex-row items-center gap-sm">
        <Text accessibilityElementsHidden importantForAccessibility="no" className="text-base">
          {kindGlyphs[kind]}
        </Text>
        <Text className="text-sm font-semibold text-muted dark:text-muted-dark">
          {kindLabels[kind]}
        </Text>
        {isImportant ? (
          <Text className="text-sm font-semibold text-accent dark:text-accent-dark">
            ! Important
          </Text>
        ) : null}
        {tag === undefined ? null : (
          <Text className="rounded-pill border border-border px-sm text-sm text-primary dark:border-border-dark dark:text-primary-dark">
            {tagLabels[tag]}
          </Text>
        )}
      </View>
      <Text className="text-base text-primary dark:text-primary-dark">{factText}</Text>
      <Text className="text-sm text-muted dark:text-muted-dark">{timeLine}</Text>
      <Text className="text-sm text-muted dark:text-muted-dark">{authorLabel}</Text>
    </>
  );

  const cardClassName = `gap-xs rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark ${className}`;

  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={spoken} className={cardClassName} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens this entry"
      onPress={onPress}
      className={`min-h-touch ${cardClassName}`}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}
