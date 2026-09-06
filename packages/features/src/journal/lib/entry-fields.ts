import { amountValueSchema } from "@handoff/contracts";
import type { AmountUnit, EventDetails, EventKind, TimePrecision } from "@handoff/contracts";
import { validateEventSemantics } from "@handoff/domain";
import type { EventFieldError } from "@handoff/domain";

import type { EntryFields, EntryForm, OccurrenceTime } from "../types/entry-form";

export type EntryFieldsResult =
  { ok: true; fields: EntryFields } | { ok: false; errors: EventFieldError[] };

type Amount = { value: string | null; unit: AmountUnit | null };

type Occurrence = { occurredAt: Date | null; timePrecision: TimePrecision };

/**
 * Turns the form into the canonical event fields, then applies the shared domain rules so the
 * client shows the same field errors the server would. A blank field stays unrecorded.
 */
export function buildEntryFields(kind: EventKind, form: EntryForm): EntryFieldsResult {
  const errors: EventFieldError[] = [];
  const details = buildDetails(kind, form, errors);
  const amount = buildAmount(kind, form, errors);
  const occurrence = buildOccurrence(form.occurrence, errors);
  const endedAt = buildEndedAt(kind, form, errors);
  if (details === null || errors.length > 0) return { ok: false, errors };

  const fields: EntryFields = {
    kind,
    occurredAt: occurrence.occurredAt,
    endedAt,
    timePrecision: occurrence.timePrecision,
    amountValue: amount.value,
    amountUnit: amount.unit,
    details,
    important: form.important,
  };

  const semantics = validateEventSemantics({
    kind,
    occurredAt: fields.occurredAt,
    endedAt: fields.endedAt,
    timePrecision: fields.timePrecision,
    amountValue: fields.amountValue,
    amountUnit: fields.amountUnit,
    details: fields.details,
  });
  if (!semantics.ok) return { ok: false, errors: semantics.errors };
  return { ok: true, fields };
}

function buildOccurrence(occurrence: OccurrenceTime, errors: EventFieldError[]): Occurrence {
  if (occurrence.choice === null) {
    errors.push({ field: "occurredAt", message: "Choose when this happened" });
    return { occurredAt: null, timePrecision: "unknown" };
  }
  if (occurrence.choice === "unknown") return { occurredAt: null, timePrecision: "unknown" };
  if (occurrence.instant === null) {
    errors.push({ field: "occurredAt", message: "Pick the date and time" });
    return { occurredAt: null, timePrecision: "unknown" };
  }
  return { occurredAt: occurrence.instant, timePrecision: "exact" };
}

// Only a sleep interval records an end; a reported start or end stays a single moment.
function buildEndedAt(kind: EventKind, form: EntryForm, errors: EventFieldError[]): Date | null {
  if (kind !== "sleep" || form.sleep.state !== "interval") return null;
  if (form.endOccurrence.choice === null || form.endOccurrence.instant === null) {
    errors.push({ field: "endedAt", message: "Choose when the sleep ended" });
    return null;
  }
  return form.endOccurrence.instant;
}

function buildAmount(kind: EventKind, form: EntryForm, errors: EventFieldError[]): Amount {
  if (kind !== "feed") return { value: null, unit: null };
  const text = form.feed.amountText.trim();
  if (text.length === 0) {
    if (form.feed.amountUnit !== null) {
      errors.push({ field: "amountValue", message: "Enter the amount, or clear the unit" });
    }
    // An empty amount means it was not measured; it never becomes zero.
    return { value: null, unit: null };
  }
  if (!amountValueSchema.safeParse(text).success) {
    errors.push({ field: "amountValue", message: "Enter a number above zero, like 60 or 4.5" });
    return { value: null, unit: null };
  }
  if (form.feed.amountUnit === null) {
    errors.push({ field: "amountUnit", message: "Choose the unit for this amount" });
    return { value: null, unit: null };
  }
  return { value: text, unit: form.feed.amountUnit };
}

function buildDetails(
  kind: EventKind,
  form: EntryForm,
  errors: EventFieldError[],
): EventDetails | null {
  if (kind === "feed") {
    const description = form.feed.description.trim();
    return {
      kind: "feed",
      method: form.feed.method,
      ...(description.length === 0 ? {} : { description }),
    };
  }

  if (kind === "diaper") {
    if (form.diaper.contents === null) {
      errors.push({ field: "details.contents", message: "Choose wet, stool, or both" });
      return null;
    }
    const quantity = form.diaper.quantity.trim();
    const note = form.diaper.note.trim();
    return {
      kind: "diaper",
      contents: form.diaper.contents,
      ...(quantity.length === 0 ? {} : { quantity }),
      ...(note.length === 0 ? {} : { note }),
    };
  }

  if (kind === "sleep") {
    if (form.sleep.state === null) {
      errors.push({ field: "details.state", message: "Choose what was observed about sleep" });
      return null;
    }
    const note = form.sleep.note.trim();
    return { kind: "sleep", state: form.sleep.state, ...(note.length === 0 ? {} : { note }) };
  }

  if (kind === "milestone") {
    const description = form.milestone.description.trim();
    if (description.length === 0) {
      errors.push({ field: "details.description", message: "Describe what happened" });
      return null;
    }
    const quote = form.milestone.quote.trim();
    return {
      kind: "milestone",
      description,
      reportedFirst: form.milestone.reportedFirst,
      ...(quote.length === 0 ? {} : { quote }),
    };
  }

  const text = form.note.text.trim();
  if (text.length === 0) {
    errors.push({ field: "details.text", message: "Write the note" });
  }
  if (form.note.intent === null) {
    errors.push({ field: "details.intent", message: "Choose what kind of note this is" });
  }
  if (text.length === 0 || form.note.intent === null) return null;
  return { kind: "note", text, intent: form.note.intent };
}
