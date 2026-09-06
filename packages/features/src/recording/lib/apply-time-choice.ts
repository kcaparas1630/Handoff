import type { CaptureAmbiguity } from "@handoff/contracts";
import {
  formatWallClock,
  getZonedParts,
  shiftWallDay,
  wallDayDifference,
  zonedTimeToInstant,
} from "@handoff/domain";

export type DayChoice = "capture-day" | "previous-day";
export type MeridiemChoice = "am" | "pm";

/**
 * The draft carries a resolved instant plus the flags saying what nobody actually said. The spoken
 * components are not in the draft, so the review screen recomputes the alternatives from the
 * resolved reading itself: the same clock time on the other day, or the other half of the day.
 */

function toInstant(wall: ReturnType<typeof getZonedParts>, timezone: string, fallback: Date): Date {
  const [instant] = zonedTimeToInstant(wall, timezone).instants;
  return instant ?? fallback;
}

export function currentDayChoice(occurredAt: Date, capturedAt: Date, timezone: string): DayChoice {
  return wallDayDifference(occurredAt, capturedAt, timezone) === 0 ? "capture-day" : "previous-day";
}

/** Keeps the clock reading and moves only the calendar day, so no time is invented. */
export function applyDayChoice(input: {
  occurredAt: Date;
  capturedAt: Date;
  timezone: string;
  choice: DayChoice;
}): Date {
  const { occurredAt, capturedAt, timezone, choice } = input;
  const spoken = getZonedParts(occurredAt, timezone);
  const captureDay = getZonedParts(capturedAt, timezone);
  const targetDay = choice === "capture-day" ? captureDay : shiftWallDay(captureDay, -1);
  return toInstant(
    { ...targetDay, hour: spoken.hour, minute: spoken.minute },
    timezone,
    occurredAt,
  );
}

export function currentMeridiem(occurredAt: Date, timezone: string): MeridiemChoice {
  return getZonedParts(occurredAt, timezone).hour < 12 ? "am" : "pm";
}

/** Moves the reading between the two halves of the same local day; the date is untouched. */
export function applyMeridiemChoice(input: {
  occurredAt: Date;
  timezone: string;
  choice: MeridiemChoice;
}): Date {
  const { occurredAt, timezone, choice } = input;
  const wall = getZonedParts(occurredAt, timezone);
  const hour = choice === "am" ? wall.hour % 12 : (wall.hour % 12) + 12;
  return toInstant({ ...wall, hour }, timezone, occurredAt);
}

/** The specific question experience-design.md section 3 asks for, or null when nothing is open. */
export function describeTimePrompt(
  occurredAt: Date | null,
  timezone: string,
  ambiguities: readonly CaptureAmbiguity[],
): string | null {
  if (occurredAt === null) return null;
  const clock = formatWallClock(occurredAt, timezone);
  const questions: string[] = [];
  if (ambiguities.includes("date_unknown")) questions.push(`Which day was ${clock}?`);
  if (ambiguities.includes("am_pm_unknown")) questions.push("Morning or afternoon?");
  return questions.length === 0 ? null : questions.join(" ");
}
