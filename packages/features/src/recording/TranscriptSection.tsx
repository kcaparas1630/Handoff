import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import type { TranscriptSectionProps } from "./types/review";

/**
 * The source words, available but collapsed. experience-design.md section 3 asks for the
 * transcript to be inspectable without dominating the review screen.
 */
export function TranscriptSection({ rawTranscript, formattedText }: TranscriptSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const body = formattedText ?? rawTranscript;
  if (body === null || body.length === 0) return null;

  return (
    <View className="gap-sm">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={isOpen ? "Hide what was recorded" : "Show what was recorded"}
        onPress={() => setIsOpen((open) => !open)}
        className="min-h-touch justify-center"
      >
        <Text className="text-base font-semibold text-primary underline dark:text-primary-dark">
          {isOpen ? "Hide what was recorded" : "Show what was recorded"}
        </Text>
      </Pressable>

      {isOpen ? (
        <View className="gap-sm rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark">
          <Text className="text-sm text-primary dark:text-primary-dark">{body}</Text>
          {/* Only shown when it differs, so the caregiver can check the tidied wording. */}
          {formattedText !== null && rawTranscript !== null && formattedText !== rawTranscript ? (
            <Text className="text-sm text-muted dark:text-muted-dark">
              {`As spoken: ${rawTranscript}`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
