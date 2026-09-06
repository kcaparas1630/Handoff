import { useCreateTextCapture } from "@handoff/api-client";
import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { LabeledTextInput } from "../shared/LabeledTextInput";
import { describeError } from "../shared/lib/describe-error";
import { useReducedMotion } from "../shared/useReducedMotion";
import type { TypeInsteadSheetProps } from "./types/recording";

// Recorded with the capture so a later reader knows the language the entry was written in.
const deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale;

/**
 * The typed alternative to speaking. It goes through the same review step as a recording, so
 * nothing typed here is published without the caregiver confirming the drafted entries.
 */
export function TypeInsteadSheet({
  childId,
  childName,
  timezone,
  careSessionId,
  onCreated,
  onClose,
}: TypeInsteadSheetProps) {
  const [text, setText] = useState("");
  const isReducedMotion = useReducedMotion();
  const create = useCreateTextCapture(childId);

  function handleSubmit(): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    create.mutate(
      {
        text: trimmed,
        capturedAt: new Date().toISOString(),
        timezone,
        locale: deviceLocale,
        ...(careSessionId === undefined ? {} : { careSessionId }),
      },
      { onSuccess: (capture) => onCreated(capture.id) },
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType={isReducedMotion ? "none" : "slide"}
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close without sending"
        onPress={onClose}
        className="flex-1 bg-primary/40"
      />
      <View className="gap-lg rounded-t-lg border-t border-border bg-surface px-lg pb-xl pt-lg dark:border-border-dark dark:bg-surface-dark">
        <View className="gap-xs">
          <Text className="text-xl font-semibold text-primary dark:text-primary-dark">
            Type an update
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">
            for {childName}. You review the entries before anything is saved.
          </Text>
        </View>

        <LabeledTextInput
          label="What happened?"
          value={text}
          onChangeText={setText}
          placeholder="Fed 60 ml at two, then a wet diaper"
          isMultiline
          testID="type-instead-text"
        />

        {create.isPending ? <StatusMessage tone="info" message="Sending…" /> : null}
        {create.isError ? (
          <StatusMessage tone="error" message={describeError(create.error)} />
        ) : null}

        <Button
          label="Prepare update"
          onPress={handleSubmit}
          isDisabled={text.trim().length === 0}
          isLoading={create.isPending}
          testID="type-instead-submit"
        />
        <Button label="Close" variant="quiet" onPress={onClose} isDisabled={create.isPending} />
      </View>
    </Modal>
  );
}
