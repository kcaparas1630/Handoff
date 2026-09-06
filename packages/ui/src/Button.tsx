import { cssInterop } from "nativewind";
import { ActivityIndicator, Pressable, Text } from "react-native";

import type { ButtonProps, ButtonVariant } from "./types/button";

// Lets the spinner inherit the label colour from a text utility class.
cssInterop(ActivityIndicator, {
  className: { target: false, nativeStyleToProp: { color: true } },
});

const containerClassNames: Record<ButtonVariant, string> = {
  primary: "bg-primary dark:bg-primary-dark",
  secondary: "bg-surface dark:bg-surface-dark border border-border dark:border-border-dark",
  quiet: "bg-transparent",
};

const labelClassNames: Record<ButtonVariant, string> = {
  primary: "text-surface dark:text-background-dark",
  secondary: "text-primary dark:text-primary-dark",
  quiet: "text-primary dark:text-primary-dark",
};

export function Button({
  label,
  onPress,
  variant = "primary",
  accessibilityLabel,
  accessibilityHint,
  isDisabled = false,
  isLoading = false,
  className = "",
  testID,
}: ButtonProps) {
  // A press while loading would submit twice, so loading blocks the handler as well.
  const isInactive = isDisabled || isLoading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isInactive, busy: isLoading }}
      disabled={isInactive}
      onPress={onPress}
      testID={testID}
      className={`min-h-touch flex-row items-center justify-center gap-sm rounded-lg px-lg py-md ${containerClassNames[variant]} ${isDisabled ? "opacity-50" : ""} ${className}`}
    >
      {isLoading ? (
        <ActivityIndicator
          accessibilityElementsHidden
          importantForAccessibility="no"
          size="small"
          className={labelClassNames[variant]}
        />
      ) : null}
      <Text className={`text-base font-semibold ${labelClassNames[variant]}`}>{label}</Text>
    </Pressable>
  );
}
