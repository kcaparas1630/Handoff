import type { AmountUnit, FeedMethod } from "@handoff/contracts";
import { Text, View } from "react-native";

import { ChoiceChips } from "../../shared/ChoiceChips";
import { LabeledTextInput } from "../../shared/LabeledTextInput";
import type { ChoiceOption } from "../../shared/types/choice-chips";
import type { FeedFieldsProps } from "../types/entry-field-groups";
import { FieldError } from "./FieldError";

const methodOptions: readonly ChoiceOption<FeedMethod>[] = [
  { value: "bottle", label: "Bottle" },
  { value: "breast", label: "Breast" },
  { value: "solid", label: "Solid" },
  { value: "unknown", label: "Not stated" },
];

const unitOptions: readonly ChoiceOption<AmountUnit>[] = [
  { value: "ml", label: "ml" },
  { value: "oz", label: "oz" },
  { value: "g", label: "g" },
];

export function FeedFields({ fields, onChange, errors }: FeedFieldsProps) {
  return (
    <View className="gap-lg">
      <ChoiceChips
        label="How was the feed given?"
        options={methodOptions}
        selectedValues={[fields.method]}
        onSelect={(method) => onChange({ ...fields, method })}
      />

      <View className="gap-sm">
        <LabeledTextInput
          label="Amount (optional)"
          value={fields.amountText}
          onChangeText={(amountText) => onChange({ ...fields, amountText })}
          placeholder="60"
          keyboardType="decimal-pad"
          hint="Leave this empty if the amount was not measured. It is never recorded as zero."
          testID="feed-amount"
        />
        <FieldError message={errors.amountValue} />
        <ChoiceChips
          label="Unit"
          options={unitOptions}
          selectedValues={fields.amountUnit === null ? [] : [fields.amountUnit]}
          onSelect={(unit) =>
            onChange({ ...fields, amountUnit: fields.amountUnit === unit ? null : unit })
          }
        />
        <FieldError message={errors.amountUnit} />
        <Text className="text-sm text-muted dark:text-muted-dark">
          Tap the chosen unit again to clear it.
        </Text>
      </View>

      <LabeledTextInput
        label="Anything to add (optional)"
        value={fields.description}
        onChangeText={(description) => onChange({ ...fields, description })}
        placeholder="Took it slowly"
      />
    </View>
  );
}
