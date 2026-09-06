import type { DraftCandidate, EventKind } from "@handoff/contracts";
import type { EventFieldError } from "@handoff/domain";

import type { EntryForm } from "../types/entry-form";
import { buildEntryFields } from "./entry-fields";

export type BuildCandidateInput = {
  kind: EventKind;
  form: EntryForm;
  /** Defaults to a fresh UUID. The id is stable across edits so confirmation can deduplicate. */
  candidateId?: string;
};

export type BuildCandidateResult =
  { ok: true; candidate: DraftCandidate } | { ok: false; errors: EventFieldError[] };

/**
 * Turns a reviewed manual entry into the single draft candidate the capture is created with.
 * Manual entry has no transcript, so the source span and quote stay null.
 */
export function buildCandidate({
  kind,
  form,
  candidateId,
}: BuildCandidateInput): BuildCandidateResult {
  const built = buildEntryFields(kind, form);
  if (!built.ok) return built;

  const { fields } = built;
  return {
    ok: true,
    candidate: {
      id: candidateId ?? crypto.randomUUID(),
      kind: fields.kind,
      occurredAt: fields.occurredAt === null ? null : fields.occurredAt.toISOString(),
      endedAt: fields.endedAt === null ? null : fields.endedAt.toISOString(),
      timePrecision: fields.timePrecision,
      amountValue: fields.amountValue,
      amountUnit: fields.amountUnit,
      details: fields.details,
      important: fields.important,
      sourceQuote: null,
      sourceStart: null,
      sourceEnd: null,
      // Manual entry is already the caregiver's reviewed wording, so nothing is flagged ambiguous.
      ambiguities: [],
      discarded: false,
    },
  };
}
