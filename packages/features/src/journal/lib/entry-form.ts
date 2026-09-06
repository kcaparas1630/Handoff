import type { EventDto } from "@handoff/contracts";

import type { EntryForm } from "../types/entry-form";

/** A blank form. No time, amount, diaper contents, sleep state, or note intent is preselected. */
export function createEntryForm(): EntryForm {
  return {
    occurrence: { choice: null, instant: null },
    endOccurrence: { choice: null, instant: null },
    important: false,
    feed: { method: "unknown", amountText: "", amountUnit: null, description: "" },
    diaper: { contents: null, quantity: "", note: "" },
    sleep: { state: null, note: "" },
    milestone: { description: "", quote: "", reportedFirst: false },
    note: { text: "", intent: null },
  };
}

/** Loads a stored event back into the form so a correction starts from what was recorded. */
export function entryFormFromEvent(event: EventDto): EntryForm {
  const form = createEntryForm();
  form.important = event.important;
  form.occurrence =
    event.occurredAt === null
      ? { choice: "unknown", instant: null }
      : { choice: "earlier", instant: new Date(event.occurredAt) };
  form.endOccurrence =
    event.endedAt === null
      ? { choice: null, instant: null }
      : { choice: "earlier", instant: new Date(event.endedAt) };

  const { details } = event;
  if (details.kind === "feed") {
    form.feed = {
      method: details.method,
      amountText: event.amountValue ?? "",
      amountUnit: event.amountUnit,
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
