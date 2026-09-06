import { Pressable, Text, View } from "react-native";

import type { ChoiceChipsProps } from "./types/choice-chips";

export function ChoiceChips<Value extends string>({
  label,
  options,
  selectedValues,
  onSelect,
  emptyMessage,
  testID,
}: ChoiceChipsProps<Value>) {
  return (
    <View className="gap-sm" testID={testID}>
      <Text className="text-sm font-semibold text-primary dark:text-primary-dark">{label}</Text>
      {options.length === 0 ? (
        <Text className="text-sm text-muted dark:text-muted-dark">
          {emptyMessage ?? "Nothing to choose yet."}
        </Text>
      ) : (
        <View className="flex-row flex-wrap gap-sm">
          {options.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.label}
                onPress={() => onSelect(option.value)}
                className={`min-h-touch flex-row items-center justify-center rounded-pill border px-lg py-md ${
                  isSelected
                    ? "border-primary bg-primary dark:border-primary-dark dark:bg-primary-dark"
                    : "border-border bg-surface dark:border-border-dark dark:bg-surface-dark"
                }`}
              >
                {/* The check mark repeats the state in text, so selection is never colour-only. */}
                <Text
                  className={`text-base font-semibold ${
                    isSelected
                      ? "text-surface dark:text-background-dark"
                      : "text-primary dark:text-primary-dark"
                  }`}
                >
                  {isSelected ? `✓ ${option.label}` : option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
