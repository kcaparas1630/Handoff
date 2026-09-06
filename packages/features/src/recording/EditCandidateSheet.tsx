import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import { useReducedMotion } from "../shared/useReducedMotion";
import { EntryFieldGroup } from "../journal/entry/EntryFieldGroup";
import { OccurrenceTimeControl } from "../journal/entry/OccurrenceTimeControl";
import { toFieldErrors } from "../journal/lib/field-errors";
import type { EntryFieldErrors } from "../journal/types/entry-field-groups";
import { candidateFromForm, entryFormFromCandidate } from "./lib/candidate-form";
import type { EditCandidateSheetProps } from "./types/review";

const importantOption = [{ value: "important", label: "Mark as important" }] as const;

/**
 * Corrects one drafted entry with the same field groups manual entry uses, so an amount or a date
 * can be fixed without going back to the recorder.
 */
export function EditCandidateSheet({
  candidate,
  timezone,
  onSave,
  onClose,
}: EditCandidateSheetProps) {
  const [form, setForm] = useState(() => entryFormFromCandidate(candidate));
  const [errors, setErrors] = useState<EntryFieldErrors>({});
  const isReducedMotion = useReducedMotion();

  function handleSave(): void {
    const built = candidateFromForm(candidate, form);
    if (!built.ok) {
      setErrors(toFieldErrors(built.errors));
      return;
    }
    setErrors({});
    onSave(built.candidate);
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
        accessibilityLabel="Close without keeping these changes"
        onPress={onClose}
        className="flex-1 bg-primary/40"
      />
      <View className="max-h-[88%] gap-lg rounded-t-lg border-t border-border bg-surface px-lg pb-xl pt-lg dark:border-border-dark dark:bg-surface-dark">
        <View className="items-center">
          <View className="h-xs w-xxl rounded-pill bg-border dark:bg-border-dark" />
        </View>

        <View className="gap-xs">
          <Text className="text-xl font-semibold text-primary dark:text-primary-dark">
            Edit this entry
          </Text>
          {candidate.sourceQuote === null ? null : (
            <Text className="text-sm text-muted dark:text-muted-dark">
              {`Heard as “${candidate.sourceQuote}”`}
            </Text>
          )}
        </View>

        <ScrollView className="grow-0" keyboardShouldPersistTaps="handled">
          <View className="gap-lg pb-lg">
            <EntryFieldGroup
              kind={candidate.kind}
              form={form}
              onChange={setForm}
              timezone={timezone}
              errors={errors}
            />

            <OccurrenceTimeControl
              label="When did this happen?"
              timezone={timezone}
              value={form.occurrence}
              onChange={(occurrence) => setForm({ ...form, occurrence })}
              errorMessage={errors.occurredAt}
              testID="edit-candidate-occurrence"
            />

            <ChoiceChips
              label="Important?"
              options={importantOption}
              selectedValues={form.important ? ["important"] : []}
              onSelect={() => setForm({ ...form, important: !form.important })}
            />
          </View>
        </ScrollView>

        {Object.keys(errors).length === 0 ? null : (
          <StatusMessage tone="warning" message="Check the highlighted fields before keeping it." />
        )}

        <Button label="Keep changes" onPress={handleSave} testID="edit-candidate-save" />
        <Button label="Close" variant="quiet" onPress={onClose} />
      </View>
    </Modal>
  );
}
