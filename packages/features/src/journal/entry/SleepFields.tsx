import type { SleepState } from "@handoff/contracts";
import { View } from "react-native";

import { ChoiceChips } from "../../shared/ChoiceChips";
import { LabeledTextInput } from "../../shared/LabeledTextInput";
import type { ChoiceOption } from "../../shared/types/choice-chips";
import type { SleepFieldsProps } from "../types/entry-field-groups";
import { FieldError } from "./FieldError";
import { OccurrenceTimeControl } from "./OccurrenceTimeControl";

// The supported reported states only. A reported start is not silently paired into an interval.
const stateOptions: readonly ChoiceOption<SleepState>[] = [
  { value: "interval", label: "Slept from–to" },
  { value: "started", label: "Sleep started" },
  { value: "ended", label: "Sleep ended" },
];

export function SleepFields({
  fields,
  onChange,
  endOccurrence,
  onEndOccurrenceChange,
  timezone,
  errors,
}: SleepFieldsProps) {
  return (
    <View className="gap-lg">
      <View className="gap-sm">
        <ChoiceChips
          label="What was observed?"
          options={stateOptions}
          selectedValues={fields.state === null ? [] : [fields.state]}
          onSelect={(state) => onChange({ ...fields, state })}
          testID="sleep-state"
        />
        <FieldError message={errors["details.state"]} />
      </View>

      {fields.state === "interval" ? (
        <OccurrenceTimeControl
          label="When did the sleep end?"
          timezone={timezone}
          value={endOccurrence}
          onChange={onEndOccurrenceChange}
          allowUnknown={false}
          errorMessage={errors.endedAt}
          testID="sleep-end-time"
        />
      ) : null}

      <LabeledTextInput
        label="Anything to add (optional)"
        value={fields.note}
        onChangeText={(note) => onChange({ ...fields, note })}
        placeholder="Settled quickly"
      />
    </View>
  );
}
