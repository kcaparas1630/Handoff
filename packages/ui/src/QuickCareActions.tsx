import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { QuickCareActionKind, QuickCareActionsProps } from "./types/quick-care-actions";

const actionGlyphs: Record<QuickCareActionKind, string> = {
  feed: "\u{1F37C}",
  diaper: "\u{1F9F7}",
  sleep: "\u{1F319}",
  note: "\u{1F4DD}",
  milestone: "⭐",
};

const actionLabels: Record<QuickCareActionKind, string> = {
  feed: "Feed",
  diaper: "Diaper",
  sleep: "Sleep",
  note: "Note",
  milestone: "Milestone",
};

const primaryActions: readonly QuickCareActionKind[] = ["feed", "diaper", "sleep", "note"];

export function QuickCareActions({
  onSelect,
  canContribute,
  disabledReason,
  className = "",
  testID,
}: QuickCareActionsProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  return (
    <View className={`gap-md ${className}`} testID={testID}>
      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
        Record what happened
      </Text>

      <View className="flex-row flex-wrap gap-md">
        {primaryActions.map((kind) => (
          <ActionButton key={kind} kind={kind} onSelect={onSelect} isDisabled={!canContribute} />
        ))}
      </View>

      {isMoreOpen ? (
        <View className="flex-row flex-wrap gap-md">
          <ActionButton kind="milestone" onSelect={onSelect} isDisabled={!canContribute} />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isMoreOpen }}
        accessibilityLabel={isMoreOpen ? "Fewer entry types" : "More entry types"}
        onPress={() => setIsMoreOpen((open) => !open)}
        className="min-h-touch items-start justify-center px-xs"
      >
        <Text className="text-base font-semibold text-primary underline dark:text-primary-dark">
          {isMoreOpen ? "Less" : "More"}
        </Text>
      </Pressable>

      {canContribute ? null : (
        <Text className="text-sm text-muted dark:text-muted-dark">
          {disabledReason ?? "You can read this child's care but not add entries."}
        </Text>
      )}
    </View>
  );
}

function ActionButton({
  kind,
  onSelect,
  isDisabled,
}: {
  kind: QuickCareActionKind;
  onSelect: (kind: QuickCareActionKind) => void;
  isDisabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${actionLabels[kind].toLowerCase()} entry`}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={() => onSelect(kind)}
      testID={`quick-care-${kind}`}
      className={`min-h-touch min-w-touch grow basis-1/3 items-center justify-center gap-xs rounded-lg border border-border bg-surface px-md py-lg dark:border-border-dark dark:bg-surface-dark ${isDisabled ? "opacity-50" : ""}`}
    >
      <Text accessibilityElementsHidden importantForAccessibility="no" className="text-2xl">
        {actionGlyphs[kind]}
      </Text>
      <Text className="text-base font-semibold text-primary dark:text-primary-dark">
        {actionLabels[kind]}
      </Text>
    </Pressable>
  );
}
