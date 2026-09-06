import { isApiClientError, useSaveManualEntry } from "@handoff/api-client";
import type { EventKind } from "@handoff/contracts";
import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import { describeError } from "../shared/lib/describe-error";
import { useReducedMotion } from "../shared/useReducedMotion";
import { EntryFieldGroup } from "./entry/EntryFieldGroup";
import { OccurrenceTimeControl } from "./entry/OccurrenceTimeControl";
import { buildCandidate } from "./lib/build-candidate";
import { createEntryForm } from "./lib/entry-form";
import { fieldErrorsFromApi, toFieldErrors } from "./lib/field-errors";
import type { EntryFieldErrors } from "./types/entry-field-groups";
import type { QuickEntrySheetProps } from "./types/quick-entry-sheet";

// Recorded with the capture so a later reader knows the language the entry was written in.
const deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale;

const sheetTitles: Record<EventKind, string> = {
  feed: "Add a feed",
  diaper: "Add a diaper change",
  sleep: "Add sleep",
  milestone: "Add a milestone",
  note: "Add a note",
};

const saveLabels: Record<EventKind, string> = {
  feed: "Save feed",
  diaper: "Save diaper",
  sleep: "Save sleep",
  milestone: "Save milestone",
  note: "Save note",
};

const importantOption = [{ value: "important", label: "Mark as important" }] as const;

export function QuickEntrySheet({
  childId,
  childName,
  kind,
  timezone,
  careSessionId,
  onSaved,
  onClose,
}: QuickEntrySheetProps) {
  const [form, setForm] = useState(createEntryForm);
  const [errors, setErrors] = useState<EntryFieldErrors>({});
  const [isDirty, setIsDirty] = useState(false);
  const isReducedMotion = useReducedMotion();
  const save = useSaveManualEntry(childId);

  function updateForm(next: typeof form): void {
    setIsDirty(true);
    setForm(next);
  }

  function requestClose(): void {
    // Closing mid-save would drop the result before the entry is known to be stored.
    if (save.isPending) return;
    if (!isDirty) {
      onClose();
      return;
    }
    Alert.alert("Discard this entry?", "What you typed here has not been saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  }

  function handleSave(): void {
    const built = buildCandidate({ kind, form });
    if (!built.ok) {
      setErrors(toFieldErrors(built.errors));
      return;
    }
    setErrors({});
    save.mutate(
      {
        candidate: built.candidate,
        capturedAt: new Date().toISOString(),
        timezone,
        locale: deviceLocale,
        ...(careSessionId === undefined ? {} : { careSessionId }),
      },
      {
        onSuccess: (event) => onSaved(event),
        // The input stays on screen so a failed save can be retried without retyping.
        onError: (error) => {
          if (isApiClientError(error)) setErrors(fieldErrorsFromApi(error.fieldErrors));
        },
      },
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType={isReducedMotion ? "none" : "slide"}
      onRequestClose={requestClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close without saving"
        onPress={requestClose}
        className="flex-1 bg-primary/40"
      />
      <View className="max-h-[88%] gap-lg rounded-t-lg border-t border-border bg-surface px-lg pb-xl pt-lg dark:border-border-dark dark:bg-surface-dark">
        <View className="items-center">
          <View className="h-xs w-xxl rounded-pill bg-border dark:bg-border-dark" />
        </View>

        <View className="gap-xs">
          <Text className="text-xl font-semibold text-primary dark:text-primary-dark">
            {sheetTitles[kind]}
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">for {childName}</Text>
        </View>

        <ScrollView className="grow-0" keyboardShouldPersistTaps="handled">
          <View className="gap-lg pb-lg">
            <EntryFieldGroup
              kind={kind}
              form={form}
              onChange={updateForm}
              timezone={timezone}
              errors={errors}
            />

            <OccurrenceTimeControl
              label="When did this happen?"
              timezone={timezone}
              value={form.occurrence}
              onChange={(occurrence) => updateForm({ ...form, occurrence })}
              errorMessage={errors.occurredAt}
              testID="entry-occurrence"
            />

            <ChoiceChips
              label="Important?"
              options={importantOption}
              selectedValues={form.important ? ["important"] : []}
              onSelect={() => updateForm({ ...form, important: !form.important })}
            />
          </View>
        </ScrollView>

        {save.isPending ? <StatusMessage tone="info" message="Saving…" /> : null}
        {save.isError ? <StatusMessage tone="error" message={describeError(save.error)} /> : null}

        <Button
          label={saveLabels[kind]}
          onPress={handleSave}
          isDisabled={form.occurrence.choice === null}
          isLoading={save.isPending}
          testID="entry-save"
        />
        <Button label="Close" variant="quiet" onPress={requestClose} isDisabled={save.isPending} />
      </View>
    </Modal>
  );
}
