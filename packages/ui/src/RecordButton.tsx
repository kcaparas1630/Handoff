import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";

import type { RecordButtonProps } from "./types/record-button";

const defaultLabel = "Record update";

// The spoken state, so recording is never signalled by colour or motion alone.
const stateWords = {
  idle: "Not recording",
  recording: "Recording now",
  disabled: "Unavailable",
} as const;

export function RecordButton({
  state,
  onPress,
  label = defaultLabel,
  hintText,
  disabledReason,
  isReducedMotion = false,
  className = "",
  testID,
}: RecordButtonProps) {
  const pulse = useRef(new Animated.Value(1)).current;
  const isDisabled = state === "disabled";
  const shouldPulse = state === "recording" && !isReducedMotion;

  useEffect(() => {
    if (!shouldPulse) {
      pulse.setValue(1);
      return;
    }
    // Opacity only: nothing moves, resizes, or blocks reading while it runs.
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.45, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, shouldPulse]);

  const caption = isDisabled ? disabledReason : hintText;

  return (
    <View className={`gap-sm ${className}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${stateWords[state]}.`}
        accessibilityHint={caption}
        accessibilityState={{ disabled: isDisabled, busy: state === "recording" }}
        disabled={isDisabled}
        onPress={onPress}
        testID={testID}
        className={`min-h-[64px] flex-row items-center justify-center gap-md rounded-lg px-lg py-lg ${
          state === "recording"
            ? "border-2 border-accent bg-surface dark:border-accent-dark dark:bg-surface-dark"
            : "bg-primary dark:bg-primary-dark"
        } ${isDisabled ? "opacity-50" : ""}`}
      >
        <Animated.Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ opacity: pulse }}
          className="text-2xl"
        >
          {"\u{1F3A4}"}
        </Animated.Text>
        <Text
          className={`text-lg font-semibold ${
            state === "recording"
              ? "text-primary dark:text-primary-dark"
              : "text-surface dark:text-background-dark"
          }`}
        >
          {label}
        </Text>
      </Pressable>

      {caption === undefined ? null : (
        <Text className="text-sm text-muted dark:text-muted-dark">{caption}</Text>
      )}
    </View>
  );
}
