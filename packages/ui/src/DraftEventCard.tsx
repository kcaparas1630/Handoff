import { Pressable, Text, View } from "react-native";

import type { EventCardKind } from "./types/event-card";
import type { DraftChip, DraftEventCardProps } from "./types/draft-event-card";

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

/** One reviewable line from a draft. Nothing on this card is saved until the reviewer confirms. */
export function DraftEventCard({
  kind,
  factText,
  chips,
  ambiguityPrompt,
  isDiscarded,
  onEdit,
  onToggleDiscard,
  className = "",
  testID,
}: DraftEventCardProps) {
  return (
    <View
      className={`gap-md rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark ${className}`}
      testID={testID}
    >
      <View className="flex-row items-center gap-sm">
        <Text accessibilityElementsHidden importantForAccessibility="no" className="text-base">
          {kindGlyphs[kind]}
        </Text>
        <Text className="text-sm font-semibold text-muted dark:text-muted-dark">
          {kindLabels[kind]}
        </Text>
        {isDiscarded ? (
          <Text className="rounded-pill border border-border px-sm text-sm font-semibold text-primary dark:border-border-dark dark:text-primary-dark">
            Removed from this update
          </Text>
        ) : null}
      </View>

      <Text
        className={`text-base text-primary dark:text-primary-dark ${
          isDiscarded ? "line-through opacity-60" : ""
        }`}
      >
        {factText}
      </Text>

      {chips.length === 0 ? null : (
        <View className="flex-row flex-wrap gap-sm">
          {chips.map((chip) => (
            <ValueChip key={chip.label} chip={chip} isDiscarded={isDiscarded} />
          ))}
        </View>
      )}

      {ambiguityPrompt === undefined ? null : (
        <Text className="text-sm font-semibold text-accent dark:text-accent-dark">
          {ambiguityPrompt}
        </Text>
      )}

      <View className="flex-row flex-wrap gap-md">
        <CardAction
          label="Edit"
          hint={`Change the ${kindLabels[kind].toLowerCase()} details before saving`}
          onPress={onEdit}
          isDisabled={isDiscarded}
          testID={testID === undefined ? undefined : `${testID}-edit`}
        />
        <CardAction
          label={isDiscarded ? "Restore" : "Remove"}
          hint={
            isDiscarded
              ? "Put this back into the update"
              : "Leave this out of the update; it is not deleted from the recording"
          }
          onPress={onToggleDiscard}
          isDisabled={false}
          testID={testID === undefined ? undefined : `${testID}-discard`}
        />
      </View>
    </View>
  );
}

function ValueChip({ chip, isDiscarded }: { chip: DraftChip; isDiscarded: boolean }) {
  const needsAttention = chip.tone === "attention";
  return (
    <View
      className={`rounded-pill border px-md py-sm ${
        needsAttention
          ? "border-accent dark:border-accent-dark"
          : "border-border dark:border-border-dark"
      } ${isDiscarded ? "opacity-60" : ""}`}
    >
      <Text className="text-sm font-semibold text-primary dark:text-primary-dark">
        {needsAttention ? `? ${chip.label}` : chip.label}
      </Text>
    </View>
  );
}

function CardAction({
  label,
  hint,
  onPress,
  isDisabled,
  testID,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  isDisabled: boolean;
  testID?: string | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      testID={testID}
      className={`min-h-touch grow items-center justify-center rounded-md border border-border px-lg py-md dark:border-border-dark ${
        isDisabled ? "opacity-50" : ""
      }`}
    >
      <Text className="text-base font-semibold text-primary dark:text-primary-dark">{label}</Text>
    </Pressable>
  );
}
