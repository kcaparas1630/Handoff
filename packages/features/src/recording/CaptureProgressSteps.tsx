import { StatusMessage } from "@handoff/ui";
import { Text, View } from "react-native";

import type { CaptureProgressStepsProps } from "./types/review";

// The state is spelled out per step, so progress never depends on colour or a spinner alone.
const stateMarks = { done: "✓", current: "•", pending: "·" } as const;
const stateWords = { done: "done", current: "in progress", pending: "not started" } as const;

/** The truthful sequence from "saved on this phone" to "ready for review". */
export function CaptureProgressSteps({ progress }: CaptureProgressStepsProps) {
  return (
    <View className="gap-md">
      <StatusMessage tone={progress.tone} message={progress.headline} />
      {progress.detail === null ? null : (
        <Text className="text-sm text-muted dark:text-muted-dark">{progress.detail}</Text>
      )}

      <View className="gap-sm rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark">
        {progress.steps.map((step) => (
          <View
            key={step.key}
            accessible
            accessibilityLabel={`${step.label}, ${stateWords[step.state]}`}
            className="flex-row items-center gap-sm"
          >
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              className="text-base font-semibold text-primary dark:text-primary-dark"
            >
              {stateMarks[step.state]}
            </Text>
            <Text
              className={`text-sm ${
                step.state === "pending"
                  ? "text-muted dark:text-muted-dark"
                  : "font-semibold text-primary dark:text-primary-dark"
              }`}
            >
              {step.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
