import type { NoteIntent } from "@handoff/contracts";
import { Text, View } from "react-native";

import { ChoiceChips } from "../../shared/ChoiceChips";
import { LabeledTextInput } from "../../shared/LabeledTextInput";
import type { ChoiceOption } from "../../shared/types/choice-chips";
import type { NoteFieldsProps } from "../types/entry-field-groups";
import { FieldError } from "./FieldError";

const intentOptions: readonly ChoiceOption<NoteIntent>[] = [
  { value: "observation", label: "Something that happened" },
  { value: "planned", label: "A plan" },
  { value: "question", label: "A question" },
];

export function NoteFields({ fields, onChange, errors }: NoteFieldsProps) {
  return (
    <View className="gap-lg">
      <View className="gap-sm">
        <LabeledTextInput
          label="Note"
          value={fields.text}
          onChangeText={(text) => onChange({ ...fields, text })}
          placeholder="Seemed tired after the walk"
          testID="note-text"
        />
        <FieldError message={errors["details.text"]} />
      </View>

      <View className="gap-sm">
        <ChoiceChips
          label="What kind of note is this?"
          options={intentOptions}
          selectedValues={fields.intent === null ? [] : [fields.intent]}
          onSelect={(intent) => onChange({ ...fields, intent })}
          testID="note-intent"
        />
        <FieldError message={errors["details.intent"]} />
        {fields.intent === "planned" ? (
          <Text className="text-sm text-muted dark:text-muted-dark">
            This is a plan, not something that happened. It stays out of recorded care summaries.
          </Text>
        ) : null}
      </View>
    </View>
  );
}
