import type { DiaperContents } from "@handoff/contracts";
import { View } from "react-native";

import { ChoiceChips } from "../../shared/ChoiceChips";
import { LabeledTextInput } from "../../shared/LabeledTextInput";
import type { ChoiceOption } from "../../shared/types/choice-chips";
import type { DiaperFieldsProps } from "../types/entry-field-groups";
import { FieldError } from "./FieldError";

// No default is selected: the caregiver states what was there (experience-design.md section 2).
const contentsOptions: readonly ChoiceOption<DiaperContents>[] = [
  { value: "wet", label: "Wet" },
  { value: "stool", label: "Stool" },
  { value: "both", label: "Both" },
];

export function DiaperFields({ fields, onChange, errors }: DiaperFieldsProps) {
  return (
    <View className="gap-lg">
      <View className="gap-sm">
        <ChoiceChips
          label="What was in the diaper?"
          options={contentsOptions}
          selectedValues={fields.contents === null ? [] : [fields.contents]}
          onSelect={(contents) => onChange({ ...fields, contents })}
          testID="diaper-contents"
        />
        <FieldError message={errors["details.contents"]} />
      </View>

      <LabeledTextInput
        label="How much (optional)"
        value={fields.quantity}
        onChangeText={(quantity) => onChange({ ...fields, quantity })}
        placeholder="A lot"
        hint="Your own words are kept as written; no count is invented from them."
      />

      <LabeledTextInput
        label="Anything to add (optional)"
        value={fields.note}
        onChangeText={(note) => onChange({ ...fields, note })}
        placeholder="Slight rash, used the cream"
      />
    </View>
  );
}
