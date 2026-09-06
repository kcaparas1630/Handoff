import { formatWallClock, formatWallDate } from "@handoff/domain";
import { DraftEventCard } from "@handoff/ui";
import { View } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import type { ChoiceOption } from "../shared/types/choice-chips";
import {
  applyDayChoice,
  applyMeridiemChoice,
  currentDayChoice,
  currentMeridiem,
} from "./lib/apply-time-choice";
import type { DayChoice, MeridiemChoice } from "./lib/apply-time-choice";
import { candidateWithOccurredAt } from "./lib/candidate-form";
import { presentCandidate } from "./lib/candidate-presentation";
import type { DraftCandidateRowProps } from "./types/review";

/**
 * One draft line plus the chips that answer its open time question. The chips recompute the
 * reading locally; nothing picks a day or a half of the day on the caregiver's behalf.
 */
export function DraftCandidateRow({
  candidate,
  capturedAt,
  timezone,
  onChange,
  onEdit,
  testID,
}: DraftCandidateRowProps) {
  const presented = presentCandidate(candidate, capturedAt, timezone);
  const occurredAt = candidate.occurredAt === null ? null : new Date(candidate.occurredAt);
  const isEditable = !candidate.discarded && occurredAt !== null;
  const asksDay = isEditable && candidate.ambiguities.includes("date_unknown");
  const asksMeridiem = isEditable && candidate.ambiguities.includes("am_pm_unknown");

  return (
    <View className="gap-sm" testID={testID}>
      <DraftEventCard
        kind={candidate.kind}
        factText={presented.factText}
        chips={presented.chips}
        {...(presented.ambiguityPrompt === undefined
          ? {}
          : { ambiguityPrompt: presented.ambiguityPrompt })}
        isDiscarded={candidate.discarded}
        onEdit={onEdit}
        onToggleDiscard={() => onChange({ ...candidate, discarded: !candidate.discarded })}
        testID={testID === undefined ? undefined : `${testID}-card`}
      />

      {asksDay && occurredAt !== null ? (
        <ChoiceChips
          label="Which day?"
          options={dayOptions(occurredAt, capturedAt, timezone)}
          selectedValues={[currentDayChoice(occurredAt, capturedAt, timezone)]}
          onSelect={(choice) =>
            onChange(
              candidateWithOccurredAt(
                candidate,
                applyDayChoice({ occurredAt, capturedAt, timezone, choice }),
              ),
            )
          }
          testID={testID === undefined ? undefined : `${testID}-day`}
        />
      ) : null}

      {asksMeridiem && occurredAt !== null ? (
        <ChoiceChips
          label="Which time?"
          options={meridiemOptions(occurredAt, timezone)}
          selectedValues={[currentMeridiem(occurredAt, timezone)]}
          onSelect={(choice) =>
            onChange(
              candidateWithOccurredAt(
                candidate,
                applyMeridiemChoice({ occurredAt, timezone, choice }),
              ),
            )
          }
          testID={testID === undefined ? undefined : `${testID}-meridiem`}
        />
      ) : null}
    </View>
  );
}

function dayOptions(
  occurredAt: Date,
  capturedAt: Date,
  timezone: string,
): readonly ChoiceOption<DayChoice>[] {
  const label = (choice: DayChoice): string =>
    formatWallDate(applyDayChoice({ occurredAt, capturedAt, timezone, choice }), timezone);
  return [
    { value: "capture-day", label: `This day (${label("capture-day")})` },
    { value: "previous-day", label: `Yesterday (${label("previous-day")})` },
  ];
}

function meridiemOptions(
  occurredAt: Date,
  timezone: string,
): readonly ChoiceOption<MeridiemChoice>[] {
  const label = (choice: MeridiemChoice): string =>
    formatWallClock(applyMeridiemChoice({ occurredAt, timezone, choice }), timezone);
  return [
    { value: "am", label: `AM (${label("am")})` },
    { value: "pm", label: `PM (${label("pm")})` },
  ];
}
