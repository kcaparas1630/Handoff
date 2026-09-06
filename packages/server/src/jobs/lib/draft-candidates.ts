// Turns a validated extraction response into the draft a caregiver reviews. Pure: the clock, the
// timezone, and the id generator are all passed in, because the result has to be reproducible
// from a stored transcript when the evaluation replays it.
import { resolveEventTime, validateEventSemantics } from "@handoff/domain";
import { DROPPED_CANDIDATE_NOTE } from "../../ai/lib/validate-extraction";
import type {
  CaptureAmbiguity,
  DraftCandidate,
  ExtractionCandidate,
  SpokenTimeComponents,
} from "@handoff/contracts";
import type { ResolvedEventTime, SpokenTime, TimeAmbiguity } from "@handoff/domain";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DraftCandidatesInput {
  candidates: readonly ExtractionCandidate[];
  notes: readonly string[];
  capturedAt: Date;
  timezone: string;
  newId: () => string;
}

export interface DraftCandidatesResult {
  candidates: DraftCandidate[];
  notes: string[];
}

/**
 * A candidate whose resolved values could not describe care is dropped and noted; the rest of the
 * recording survives. Nothing here decides anything for the caregiver: every guess the time
 * resolver had to make comes back as an ambiguity they confirm.
 */
export function buildDraftCandidates(input: DraftCandidatesInput): DraftCandidatesResult {
  const candidates: DraftCandidate[] = [];
  let dropped = false;

  for (const candidate of input.candidates) {
    const draft = toDraftCandidate(candidate, input);
    if (draft === null) {
      dropped = true;
      continue;
    }
    candidates.push(draft);
  }

  const notes = [...input.notes];
  if (dropped && !notes.includes(DROPPED_CANDIDATE_NOTE)) notes.push(DROPPED_CANDIDATE_NOTE);
  return { candidates, notes: notes.slice(0, 5) };
}

function toDraftCandidate(
  candidate: ExtractionCandidate,
  input: DraftCandidatesInput,
): DraftCandidate | null {
  const start = resolveEventTime({
    spokenTime: toSpokenTime(candidate.spokenTime),
    capturedAt: input.capturedAt,
    timezone: input.timezone,
  });
  const end = resolveInterval(candidate, start, input);

  const draft: DraftCandidate = {
    // Stable from here on: confirmation dedupes with UNIQUE (capture_id, source_candidate_id).
    id: input.newId(),
    kind: candidate.kind,
    occurredAt: start.occurredAt === null ? null : start.occurredAt.toISOString(),
    endedAt: end.endedAt === null ? null : end.endedAt.toISOString(),
    timePrecision: start.timePrecision,
    amountValue: candidate.amountValue,
    amountUnit: candidate.amountUnit,
    details: candidate.details,
    // The extractor never marks a fact important; a caregiver does, in review.
    important: false,
    sourceQuote: candidate.sourceQuote,
    sourceStart: candidate.sourceStart,
    sourceEnd: candidate.sourceEnd,
    ambiguities: mergeAmbiguities(candidate, start.ambiguities, end.shifted),
    discarded: false,
  };

  const semantics = validateEventSemantics({
    kind: draft.kind,
    occurredAt: start.occurredAt,
    endedAt: end.endedAt,
    timePrecision: draft.timePrecision,
    amountValue: draft.amountValue,
    amountUnit: draft.amountUnit,
    details: draft.details,
  });
  return semantics.ok ? draft : null;
}

/**
 * A sleep interval is two readings of the same clock. "From eight pm to six am" resolves each end
 * independently, so an end that lands before its start is moved to the next reading after it.
 * The shift is flagged, because nobody stated the day. Adding whole days ignores a daylight-saving
 * change inside the interval; the caregiver confirms both times before anything is saved.
 */
function resolveInterval(
  candidate: ExtractionCandidate,
  start: ResolvedEventTime,
  input: DraftCandidatesInput,
): { endedAt: Date | null; shifted: boolean } {
  if (candidate.spokenEndTime === null) return { endedAt: null, shifted: false };
  const resolved = resolveEventTime({
    spokenTime: toSpokenTime(candidate.spokenEndTime),
    capturedAt: input.capturedAt,
    timezone: input.timezone,
  });
  const startedAt = start.occurredAt;
  if (resolved.occurredAt === null || startedAt === null) return { endedAt: null, shifted: false };
  if (resolved.occurredAt.getTime() > startedAt.getTime()) {
    return { endedAt: resolved.occurredAt, shifted: false };
  }
  const later = resolved.proposedDates.find((proposal) => proposal.getTime() > startedAt.getTime());
  if (later !== undefined) return { endedAt: later, shifted: true };
  return { endedAt: new Date(resolved.occurredAt.getTime() + DAY_MS), shifted: true };
}

/**
 * The transport ambiguity set is closed and has no daylight-saving flag, so an ambiguous or
 * skipped local time is reported as an unconfirmed date rather than silently dropped.
 */
const ambiguityByTimeFlag: Record<TimeAmbiguity, CaptureAmbiguity> = {
  date_unknown: "date_unknown",
  am_pm_unknown: "am_pm_unknown",
  dst_ambiguous: "date_unknown",
};

function mergeAmbiguities(
  candidate: ExtractionCandidate,
  timeFlags: readonly TimeAmbiguity[],
  shiftedEnd: boolean,
): CaptureAmbiguity[] {
  const merged = new Set<CaptureAmbiguity>(candidate.ambiguities);
  for (const flag of timeFlags) merged.add(ambiguityByTimeFlag[flag]);
  if (shiftedEnd) merged.add("date_unknown");
  // The model's booleans are authoritative over its own list: a negated or planned statement must
  // carry its flag, because isCompletedCareCandidate reads exactly these.
  if (candidate.negated) merged.add("negation");
  if (candidate.planned) merged.add("planned");
  if (candidate.mentionsOtherChild) merged.add("other_child");
  return [...merged];
}

/** The transport shape uses optional keys; the domain type is the same fields, so this is a copy. */
function toSpokenTime(spoken: SpokenTimeComponents | null): SpokenTime | null {
  if (spoken === null) return null;
  return {
    ...(spoken.hour === undefined ? {} : { hour: spoken.hour }),
    ...(spoken.minute === undefined ? {} : { minute: spoken.minute }),
    ...(spoken.meridiem === undefined ? {} : { meridiem: spoken.meridiem }),
    ...(spoken.dayOffset === undefined ? {} : { dayOffset: spoken.dayOffset }),
    ...(spoken.isNow === undefined ? {} : { isNow: spoken.isNow }),
  };
}
