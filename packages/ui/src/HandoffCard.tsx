import { Text, View } from "react-native";

import { Button } from "./Button";
import type { HandoffCardProps } from "./types/handoff-card";

const cardClassName = "gap-md rounded-lg border bg-surface px-lg py-lg dark:bg-surface-dark";

export function HandoffCard({
  childName,
  unreadCount,
  previewText,
  onOpen,
  className = "",
  testID,
}: HandoffCardProps) {
  if (unreadCount === 0) {
    return (
      <View
        className={`${cardClassName} border-border dark:border-border-dark ${className}`}
        testID={testID}
      >
        <Text className="text-base font-semibold text-primary dark:text-primary-dark">
          You&apos;re up to date
        </Text>
        <Text className="text-sm text-muted dark:text-muted-dark">
          No new changes since your last handoff.
        </Text>
        <Button label="Open handoff" variant="quiet" onPress={onOpen} testID="handoff-card-open" />
      </View>
    );
  }

  const countText = unreadCount === 1 ? "1 update" : `${unreadCount} updates`;

  return (
    <View
      className={`${cardClassName} border-accent dark:border-accent-dark ${className}`}
      testID={testID}
    >
      <Text className="text-xl font-semibold text-primary dark:text-primary-dark">
        Catch up on {childName}&apos;s care
      </Text>
      <Text className="text-base text-primary dark:text-primary-dark">
        {countText} since your last handoff
      </Text>
      {previewText === null ? null : (
        <Text className="text-sm text-muted dark:text-muted-dark">{previewText}</Text>
      )}
      <Button
        label="Read handoff"
        onPress={onOpen}
        accessibilityLabel={`Read handoff for ${childName}, ${countText}`}
        testID="handoff-card-open"
      />
    </View>
  );
}
