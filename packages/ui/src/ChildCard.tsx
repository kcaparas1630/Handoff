import { Pressable, Text, View } from "react-native";

import type { ChildCardProps } from "./types/child-card";

export function ChildCard({
  name,
  secondaryLine,
  badge,
  onPress,
  accessibilityLabel,
  className = "",
  testID,
}: ChildCardProps) {
  const spokenLabel = accessibilityLabel ?? [name, secondaryLine].filter(Boolean).join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      onPress={onPress}
      testID={testID}
      className={`min-h-touch flex-row items-center gap-md rounded-lg border border-border bg-surface px-lg py-lg dark:border-border-dark dark:bg-surface-dark ${className}`}
    >
      <View className="flex-1 gap-xs">
        <Text className="text-lg font-semibold text-primary dark:text-primary-dark">{name}</Text>
        {secondaryLine ? (
          <Text className="text-sm text-muted dark:text-muted-dark">{secondaryLine}</Text>
        ) : null}
      </View>
      {badge ? (
        <View
          accessibilityLabel={badge.accessibilityLabel}
          className="min-h-touch min-w-touch items-center justify-center rounded-pill bg-accent px-md dark:bg-accent-dark"
        >
          <Text className="text-sm font-semibold text-surface dark:text-background-dark">
            {badge.text}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
