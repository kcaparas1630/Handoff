import { Text, View } from "react-native";

import type { StatusMessageProps, StatusTone } from "./types/status-message";

// Glyph plus a spoken word prefix, so tone never depends on colour alone.
const toneGlyphs: Record<StatusTone, string> = {
  info: "i",
  success: "✓",
  warning: "!",
  error: "×",
};

const tonePrefixes: Record<StatusTone, string> = {
  info: "Info",
  success: "Done",
  warning: "Check",
  error: "Error",
};

const toneClassNames: Record<StatusTone, string> = {
  info: "border-border dark:border-border-dark",
  success: "border-primary dark:border-primary-dark",
  warning: "border-accent dark:border-accent-dark",
  error: "border-accent dark:border-accent-dark",
};

export function StatusMessage({ tone, message, className = "", testID }: StatusMessageProps) {
  return (
    <View
      accessibilityLiveRegion="polite"
      testID={testID}
      className={`flex-row items-start gap-md rounded-md border bg-surface px-lg py-md dark:bg-surface-dark ${toneClassNames[tone]} ${className}`}
    >
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        className="text-base font-semibold text-primary dark:text-primary-dark"
      >
        {toneGlyphs[tone]}
      </Text>
      <Text className="flex-1 text-sm text-primary dark:text-primary-dark">
        <Text className="font-semibold">{tonePrefixes[tone]}: </Text>
        {message}
      </Text>
    </View>
  );
}
