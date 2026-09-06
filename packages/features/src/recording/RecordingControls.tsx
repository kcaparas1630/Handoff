import { Button } from "@handoff/ui";
import { Text, View } from "react-native";

import { formatElapsed } from "./lib/recording-examples";
import type { RecordingControlsProps } from "./types/recording-controls";

/**
 * What is on screen while the microphone is live: the child, the elapsed time, a restrained level
 * indicator, and the two actions. A tap works one-handed; nothing has to be held down.
 */
export function RecordingControls({
  childName,
  elapsedMs,
  maxDurationMs,
  meteringLevel,
  isBusy,
  onStop,
  onCancel,
}: RecordingControlsProps) {
  const remainingSeconds = Math.max(0, Math.ceil((maxDurationMs - elapsedMs) / 1000));

  return (
    <View className="gap-lg rounded-md border border-accent bg-surface px-lg py-lg dark:border-accent-dark dark:bg-surface-dark">
      <Text className="text-sm font-semibold text-muted dark:text-muted-dark">
        Recording for {childName}
      </Text>

      <Text
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Recording, ${formatElapsed(elapsedMs)} so far`}
        className="text-2xl font-semibold text-primary dark:text-primary-dark"
      >
        {formatElapsed(elapsedMs)}
      </Text>

      <LevelIndicator level={meteringLevel} />

      <Text className="text-sm text-muted dark:text-muted-dark">
        {`Recording stops by itself after ${Math.round(maxDurationMs / 1000)} seconds. ${remainingSeconds} left.`}
      </Text>

      <Button label="Stop" onPress={onStop} isLoading={isBusy} testID="record-stop" />
      <Button
        label="Cancel"
        variant="secondary"
        onPress={onCancel}
        isDisabled={isBusy}
        accessibilityHint="Discards this recording without keeping it"
        testID="record-cancel"
      />
    </View>
  );
}

// A single quiet bar. It is decoration for a state the elapsed time already states in words.
function LevelIndicator({ level }: { level: number | null }) {
  const width = level === null ? 0 : Math.round(level * 100);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      className="h-sm w-full overflow-hidden rounded-pill bg-border dark:bg-border-dark"
    >
      <View className="h-full bg-accent dark:bg-accent-dark" style={{ width: `${width}%` }} />
    </View>
  );
}
