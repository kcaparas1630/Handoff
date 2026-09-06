import type { CaptureAmbiguity, DraftCandidate } from "@handoff/contracts";
import { formatWallClock, formatWallDate, renderFactText } from "@handoff/domain";
import type { DraftChip } from "@handoff/ui";

import { describeTimePrompt } from "./apply-time-choice";

export type CandidatePresentation = {
  factText: string;
  chips: DraftChip[];
  /** The specific question to answer before saving, or undefined when nothing is open. */
  ambiguityPrompt?: string;
};

// Flags that change what the entry means, so they are shown as their own chip rather than hidden.
const flagLabels: Partial<Record<CaptureAmbiguity, string>> = {
  negation: "Reported as not done",
  planned: "Planned, not recorded care",
  other_child: "Mentions another child",
  duplicate_suspected: "May already be recorded",
};

/**
 * Renders one draft candidate for review using the same deterministic templates the journal and
 * the brief use. Nothing missing is filled in: an unstated amount stays unstated.
 */
export function presentCandidate(
  candidate: DraftCandidate,
  capturedAt: Date,
  timezone: string,
): CandidatePresentation {
  const occurredAt = candidate.occurredAt === null ? null : new Date(candidate.occurredAt);
  const factText = renderFactText(
    candidate.kind,
    {
      occurredAt,
      endedAt: candidate.endedAt === null ? null : new Date(candidate.endedAt),
      timePrecision: candidate.timePrecision,
      amountValue: candidate.amountValue,
      amountUnit: candidate.amountUnit,
      details: candidate.details,
      reportedAt: capturedAt,
    },
    timezone,
  );

  const prompt = describeTimePrompt(occurredAt, timezone, candidate.ambiguities);
  const presentation: CandidatePresentation = {
    factText,
    chips: [
      ...amountChips(candidate),
      timeChip(candidate, occurredAt, timezone),
      ...flagChips(candidate),
    ],
  };
  return prompt === null ? presentation : { ...presentation, ambiguityPrompt: prompt };
}

function amountChips(candidate: DraftCandidate): DraftChip[] {
  if (candidate.ambiguities.includes("amount_unknown")) {
    return [{ label: "Amount not stated", tone: "attention" }];
  }
  if (candidate.amountValue === null) return [];
  if (candidate.amountUnit === null || candidate.ambiguities.includes("unit_unknown")) {
    return [{ label: `${candidate.amountValue}, unit not stated`, tone: "attention" }];
  }
  return [{ label: `${candidate.amountValue} ${candidate.amountUnit}`, tone: "neutral" }];
}

function timeChip(candidate: DraftCandidate, occurredAt: Date | null, timezone: string): DraftChip {
  if (occurredAt === null) return { label: "Time not given", tone: "neutral" };
  const label = `${formatWallDate(occurredAt, timezone)} ${formatWallClock(occurredAt, timezone)}`;
  const isUncertain =
    candidate.ambiguities.includes("date_unknown") ||
    candidate.ambiguities.includes("am_pm_unknown");
  return { label, tone: isUncertain ? "attention" : "neutral" };
}

function flagChips(candidate: DraftCandidate): DraftChip[] {
  const chips: DraftChip[] = [];
  for (const ambiguity of candidate.ambiguities) {
    const label = flagLabels[ambiguity];
    if (label !== undefined) chips.push({ label, tone: "attention" });
  }
  return chips;
}
