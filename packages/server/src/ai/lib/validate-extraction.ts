// Semantic validation of one extraction response. Pure: no clock, no database, no provider.
// Valid JSON is not evidence that the model reported what was actually said (AGENTS.md), so the
// spans are checked against the transcript and the values against the domain rules.
import { validateEventSemantics } from "@handoff/domain";
import type { ExtractionCandidate, ExtractionOutput } from "@handoff/contracts";

/** The schema already caps this; it is rechecked because the cap is a product rule, not a shape. */
const MAX_CANDIDATES = 20;

export const DROPPED_CANDIDATE_NOTE = "One entry could not be read and was left out";

export interface ValidatedExtraction {
  candidates: ExtractionCandidate[];
  /** The model's own notes plus one caveat per dropped candidate, deduplicated. */
  notes: string[];
  droppedCount: number;
}

export type ExtractionValidation =
  { ok: true; value: ValidatedExtraction } | { ok: false; reason: string };

/**
 * Drops a candidate the transcript does not support and keeps the rest, because one unreadable
 * line should not lose the whole recording. A whole response that breaks a product rule is
 * rejected instead: the caller fails the job with `extraction_failed` and never repairs it.
 */
export function validateExtractionSemantics(
  output: ExtractionOutput,
  transcript: string,
): ExtractionValidation {
  if (output.candidates.length > MAX_CANDIDATES) {
    return { ok: false, reason: "candidate_limit" };
  }

  const candidates: ExtractionCandidate[] = [];
  let droppedCount = 0;
  for (const candidate of output.candidates) {
    if (isSupported(candidate, transcript)) {
      candidates.push(candidate);
      continue;
    }
    droppedCount += 1;
  }

  const notes = [...output.notes];
  if (droppedCount > 0 && !notes.includes(DROPPED_CANDIDATE_NOTE)) {
    notes.push(DROPPED_CANDIDATE_NOTE);
  }
  return { ok: true, value: { candidates, notes: notes.slice(0, 5), droppedCount } };
}

function isSupported(candidate: ExtractionCandidate, transcript: string): boolean {
  if (candidate.details.kind !== candidate.kind) return false;
  if (candidate.sourceEnd > transcript.length) return false;
  // An exact substring at the reported offsets: a quote the transcript does not contain, or one
  // pointing somewhere else, cannot be shown to the reviewer as the source of a fact.
  if (transcript.slice(candidate.sourceStart, candidate.sourceEnd) !== candidate.sourceQuote) {
    return false;
  }
  return hasUsableAmount(candidate);
}

/**
 * Amount, unit, and kind rules only. Occurrence times are resolved from the spoken components
 * afterwards, so the time fields are validated once the draft candidate exists, not here.
 */
function hasUsableAmount(candidate: ExtractionCandidate): boolean {
  const result = validateEventSemantics({
    kind: candidate.kind,
    occurredAt: null,
    endedAt: null,
    timePrecision: "unknown",
    amountValue: candidate.amountValue,
    amountUnit: candidate.amountUnit,
    details: candidate.details,
  });
  if (result.ok) return true;
  return result.errors.every((error) => error.field === "occurredAt" || error.field === "endedAt");
}
