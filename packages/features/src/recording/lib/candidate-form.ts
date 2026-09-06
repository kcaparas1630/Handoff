import type { CaptureAmbiguity, DraftCandidate } from "@handoff/contracts";
import type { EventFieldError } from "@handoff/domain";

import { buildEntryFields } from "../../journal/lib/entry-fields";
import { createEntryForm } from "../../journal/lib/entry-form";
import type { EntryFields, EntryForm } from "../../journal/types/entry-form";

export type CandidateFromFormResult =
  { ok: true; candidate: DraftCandidate } | { ok: false; errors: EventFieldError[] };

// Flags the caregiver answers by editing the field itself. Anything else is the extractor's
// report about the recording and stays on the candidate.
const timeAmbiguities: readonly CaptureAmbiguity[] = ["date_unknown", "am_pm_unknown"];
const amountAmbiguities: readonly CaptureAmbiguity[] = ["amount_unknown", "unit_unknown"];

/** Loads a draft candidate into the shared entry form so review reuses the manual field groups. */
export function entryFormFromCandidate(candidate: DraftCandidate): EntryForm {
  const form = createEntryForm();
  form.important = candidate.important;
  form.occurrence =
    candidate.occurredAt === null
      ? { choice: "unknown", instant: null }
      : { choice: "earlier", instant: new Date(candidate.occurredAt) };
  form.endOccurrence =
    candidate.endedAt === null
      ? { choice: null, instant: null }
      : { choice: "earlier", instant: new Date(candidate.endedAt) };

  const { details } = candidate;
  if (details.kind === "feed") {
    form.feed = {
      method: details.method,
      amountText: candidate.amountValue ?? "",
      amountUnit: candidate.amountUnit,
      description: details.description ?? "",
    };
  }
  if (details.kind === "diaper") {
    form.diaper = {
      contents: details.contents,
      quantity: details.quantity ?? "",
      note: details.note ?? "",
    };
  }
  if (details.kind === "sleep") {
    form.sleep = { state: details.state, note: details.note ?? "" };
  }
  if (details.kind === "milestone") {
    form.milestone = {
      description: details.description,
      quote: details.quote ?? "",
      reportedFirst: details.reportedFirst,
    };
  }
  if (details.kind === "note") {
    form.note = { text: details.text, intent: details.intent };
  }
  return form;
}

/**
 * Applies the reviewed form back onto the candidate. The id and the source span are preserved so
 * confirmation still deduplicates and the server keeps knowing where this line came from.
 */
export function candidateFromForm(
  candidate: DraftCandidate,
  form: EntryForm,
): CandidateFromFormResult {
  const built = buildEntryFields(candidate.kind, form);
  if (!built.ok) return built;

  const { fields } = built;
  return {
    ok: true,
    candidate: {
      ...candidate,
      occurredAt: fields.occurredAt === null ? null : fields.occurredAt.toISOString(),
      endedAt: fields.endedAt === null ? null : fields.endedAt.toISOString(),
      timePrecision: fields.timePrecision,
      amountValue: fields.amountValue,
      amountUnit: fields.amountUnit,
      details: fields.details,
      important: fields.important,
      ambiguities: remainingAmbiguities(candidate, fields),
    },
  };
}

/** Applies only a corrected occurrence time, which is what the date and meridiem chips do. */
export function candidateWithOccurredAt(
  candidate: DraftCandidate,
  occurredAt: Date,
): DraftCandidate {
  return {
    ...candidate,
    occurredAt: occurredAt.toISOString(),
    timePrecision: "exact",
    ambiguities: candidate.ambiguities.filter((ambiguity) => !timeAmbiguities.includes(ambiguity)),
  };
}

function remainingAmbiguities(candidate: DraftCandidate, fields: EntryFields): CaptureAmbiguity[] {
  const answeredTime = fields.occurredAt !== null;
  const answeredAmount = fields.amountValue !== null && fields.amountUnit !== null;
  return candidate.ambiguities.filter((ambiguity) => {
    if (answeredTime && timeAmbiguities.includes(ambiguity)) return false;
    if (answeredAmount && amountAmbiguities.includes(ambiguity)) return false;
    return true;
  });
}
