import {
  formatWallClock,
  formatWallDate,
  getZonedParts,
  zonedTimeToInstant,
} from "@handoff/domain";
import type { WallClock } from "@handoff/domain";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Text, View } from "react-native";

import { ChoiceChips } from "../../shared/ChoiceChips";
import type { ChoiceOption } from "../../shared/types/choice-chips";
import type { OccurrenceChoice, OccurrenceTime } from "../types/entry-form";
import type { OccurrenceTimeControlProps } from "../types/occurrence-time-control";

const baseOptions: readonly ChoiceOption<OccurrenceChoice>[] = [
  { value: "now", label: "Now" },
  { value: "earlier", label: "Earlier" },
];

const unknownOption: ChoiceOption<OccurrenceChoice> = { value: "unknown", label: "Time unknown" };

function wallToInstant(wall: WallClock, timezone: string): Date {
  const [instant] = zonedTimeToInstant(wall, timezone).instants;
  return instant ?? new Date();
}

export function OccurrenceTimeControl({
  label,
  timezone,
  value,
  onChange,
  allowUnknown = true,
  errorMessage,
  testID,
}: OccurrenceTimeControlProps) {
  // Two steps so the caregiver states the day and the clock time explicitly.
  const [pickerStep, setPickerStep] = useState<"date" | "time" | null>(null);
  const [draftWall, setDraftWall] = useState<WallClock | null>(null);

  const options = allowUnknown ? [...baseOptions, unknownOption] : baseOptions;

  function handleSelect(choice: OccurrenceChoice): void {
    if (choice === "now") {
      onChange({ choice: "now", instant: new Date() });
      return;
    }
    if (choice === "unknown") {
      onChange({ choice: "unknown", instant: null });
      return;
    }
    setDraftWall(getZonedParts(value.instant ?? new Date(), timezone));
    setPickerStep("date");
  }

  function handlePicked(event: DateTimePickerEvent, picked?: Date): void {
    if (event.type !== "set" || picked === undefined) {
      // A cancelled picker leaves the control unanswered rather than guessing a time.
      setPickerStep(null);
      return;
    }
    const parts = getZonedParts(picked, timezone);
    const base = draftWall ?? parts;
    if (pickerStep === "date") {
      setDraftWall({ ...base, year: parts.year, month: parts.month, day: parts.day });
      setPickerStep("time");
      return;
    }
    const wall = { ...base, hour: parts.hour, minute: parts.minute };
    setPickerStep(null);
    onChange({ choice: "earlier", instant: wallToInstant(wall, timezone) });
  }

  return (
    <View className="gap-sm" testID={testID}>
      <ChoiceChips
        label={label}
        options={options}
        selectedValues={value.choice === null ? [] : [value.choice]}
        onSelect={handleSelect}
      />
      <Text className="text-sm text-muted dark:text-muted-dark">
        {describeOccurrence(value, timezone)}
      </Text>
      {errorMessage === undefined ? null : (
        <Text className="text-sm font-semibold text-accent dark:text-accent-dark">
          {errorMessage}
        </Text>
      )}
      {pickerStep === null ? null : (
        <DateTimePicker
          mode={pickerStep}
          display="default"
          value={wallToInstant(draftWall ?? getZonedParts(new Date(), timezone), timezone)}
          timeZoneName={timezone}
          onChange={handlePicked}
        />
      )}
    </View>
  );
}

function describeOccurrence(value: OccurrenceTime, timezone: string): string {
  if (value.choice === null) return "No time chosen yet.";
  if (value.choice === "unknown") return "Saved without a time, because it was not stated.";
  if (value.instant === null) return "No time chosen yet.";
  const clock = formatWallClock(value.instant, timezone);
  if (value.choice === "now") return `Now — ${clock} (${timezone}).`;
  return `${formatWallDate(value.instant, timezone)} at ${clock} (${timezone}).`;
}
