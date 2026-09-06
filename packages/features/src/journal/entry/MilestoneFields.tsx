import { Text, View } from "react-native";

import { ChoiceChips } from "../../shared/ChoiceChips";
import { LabeledTextInput } from "../../shared/LabeledTextInput";
import type { MilestoneFieldsProps } from "../types/entry-field-groups";
import { FieldError } from "./FieldError";

const firstOption = [{ value: "reportedFirst", label: "Reported as a first" }] as const;

export function MilestoneFields({ fields, onChange, errors }: MilestoneFieldsProps) {
  return (
    <View className="gap-lg">
      <View className="gap-sm">
        <LabeledTextInput
          label="What happened?"
          value={fields.description}
          onChangeText={(description) => onChange({ ...fields, description })}
          placeholder="Said a new word"
          testID="milestone-description"
        />
        <FieldError message={errors["details.description"]} />
      </View>

      <LabeledTextInput
        label="Their words (optional)"
        value={fields.quote}
        onChangeText={(quote) => onChange({ ...fields, quote })}
        placeholder="Dada"
        hint="Kept exactly as you write it."
      />

      <View className="gap-sm">
        <ChoiceChips
          label="Was this a first?"
          options={firstOption}
          selectedValues={fields.reportedFirst ? ["reportedFirst"] : []}
          onSelect={() => onChange({ ...fields, reportedFirst: !fields.reportedFirst })}
        />
        <Text className="text-sm text-muted dark:text-muted-dark">
          Saved as your report of a first, not as a confirmed developmental result.
        </Text>
      </View>
    </View>
  );
}
