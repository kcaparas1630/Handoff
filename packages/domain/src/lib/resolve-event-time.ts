import type {
  ResolveEventTimeInput,
  ResolvedEventTime,
  SpokenTime,
  TimeAmbiguity,
} from "../types/event-time";
import { getZonedParts, shiftWallDay, zonedTimeToInstant } from "./zoned-time";

const UNRESOLVED: ResolvedEventTime = {
  occurredAt: null,
  timePrecision: "unknown",
  ambiguities: [],
  proposedDates: [],
};

// Turns a spoken clock reading into instants the user can confirm. It never picks a date or a
// meridiem silently: every guess it had to make comes back as an ambiguity flag.
export function resolveEventTime(input: ResolveEventTimeInput): ResolvedEventTime {
  const { spokenTime, capturedAt, timezone } = input;
  if (spokenTime === null) return UNRESOLVED;
  if (spokenTime.isNow === true) {
    return {
      occurredAt: capturedAt,
      timePrecision: "approximate",
      ambiguities: [],
      proposedDates: [capturedAt],
    };
  }
  const hour = spokenTime.hour;
  const minute = spokenTime.minute ?? 0;
  if (hour === undefined) return UNRESOLVED;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return UNRESOLVED;

  const captureWall = getZonedParts(capturedAt, timezone);
  const spokenDay = shiftWallDay(captureWall, spokenTime.dayOffset ?? 0);
  const dayWasStated = spokenTime.dayOffset !== undefined;
  const meridiemUnknown = spokenTime.meridiem === undefined && hour >= 1 && hour <= 12;

  const proposals: Date[] = [];
  let dateUnknown = false;
  let dstAmbiguous = false;

  for (const hour24 of candidateHours(hour, spokenTime.meridiem)) {
    const resolution = zonedTimeToInstant({ ...spokenDay, hour: hour24, minute }, timezone);
    if (resolution.ambiguous || resolution.nonexistent) dstAmbiguous = true;

    // A reading later than the capture itself has not happened yet, so the previous day is the
    // only sensible proposal; the date stays flagged because nobody actually said it.
    const earliest = resolution.instants[0];
    const rollBack =
      !dayWasStated && earliest !== undefined && earliest.getTime() > capturedAt.getTime();
    if (!rollBack) {
      proposals.push(...resolution.instants);
      continue;
    }
    dateUnknown = true;
    const previousDay = shiftWallDay(spokenDay, -1);
    const rolled = zonedTimeToInstant({ ...previousDay, hour: hour24, minute }, timezone);
    if (rolled.ambiguous || rolled.nonexistent) dstAmbiguous = true;
    proposals.push(...rolled.instants);
  }

  const proposedDates = orderProposals(proposals, capturedAt);
  const occurredAt = proposedDates[0] ?? null;
  if (occurredAt === null) return UNRESOLVED;

  const ambiguities: TimeAmbiguity[] = [];
  if (dateUnknown) ambiguities.push("date_unknown");
  if (meridiemUnknown) ambiguities.push("am_pm_unknown");
  if (dstAmbiguous) ambiguities.push("dst_ambiguous");

  // The clock reading itself is exact once confirmed; the flags carry what is still uncertain.
  return { occurredAt, timePrecision: "exact", ambiguities, proposedDates };
}

function candidateHours(hour: number, meridiem: SpokenTime["meridiem"]): number[] {
  if (meridiem === "am") return [hour === 12 ? 0 : hour];
  if (meridiem === "pm") return [hour === 12 ? 12 : hour + 12];
  // "At two" is two real readings; both are offered instead of one silent choice.
  // A stated 0 or 13-23 is already unambiguous.
  if (hour >= 1 && hour <= 12) {
    const morning = hour === 12 ? 0 : hour;
    return [morning, morning + 12];
  }
  return [hour];
}

// Most recent past first, then anything still in the future, so the default proposal is the
// reading a caregiver is most likely to have meant.
function orderProposals(proposals: readonly Date[], capturedAt: Date): Date[] {
  const unique = new Map<number, Date>();
  for (const proposal of proposals) unique.set(proposal.getTime(), proposal);
  const past: Date[] = [];
  const future: Date[] = [];
  for (const proposal of unique.values()) {
    if (proposal.getTime() <= capturedAt.getTime()) past.push(proposal);
    else future.push(proposal);
  }
  past.sort((a, b) => b.getTime() - a.getTime());
  future.sort((a, b) => a.getTime() - b.getTime());
  return [...past, ...future];
}
