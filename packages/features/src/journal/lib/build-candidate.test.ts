import { describe, expect, it } from "vitest";

import type { EntryForm } from "../types/entry-form";
import { buildCandidate } from "./build-candidate";
import { createEntryForm } from "./entry-form";

const candidateId = "6f5b0f5e-3a2b-4c1d-9f80-0a1b2c3d4e5f";

function formWith(changes: (form: EntryForm) => void): EntryForm {
  const form = createEntryForm();
  changes(form);
  return form;
}

describe("buildCandidate", () => {
  it("keeps an unmeasured feed amount unrecorded instead of zero", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "now", instant: new Date("2026-09-06T08:00:00.000Z") };
      draft.feed.method = "bottle";
    });

    const result = buildCandidate({ kind: "feed", form, candidateId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.amountValue).toBeNull();
    expect(result.candidate.amountUnit).toBeNull();
    expect(result.candidate.occurredAt).toBe("2026-09-06T08:00:00.000Z");
    expect(result.candidate.timePrecision).toBe("exact");
  });

  it("carries a measured amount with its unit", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "earlier", instant: new Date("2026-09-06T02:00:00.000Z") };
      draft.feed = { method: "bottle", amountText: " 60 ", amountUnit: "ml", description: "" };
    });

    const result = buildCandidate({ kind: "feed", form, candidateId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.amountValue).toBe("60");
    expect(result.candidate.amountUnit).toBe("ml");
    expect(result.candidate.id).toBe(candidateId);
  });

  it("rejects an amount without a unit", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "now", instant: new Date() };
      draft.feed.amountText = "60";
    });

    const result = buildCandidate({ kind: "feed", form, candidateId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field)).toContain("amountUnit");
  });

  it("refuses to guess an occurrence time that was never chosen", () => {
    const form = formWith((draft) => {
      draft.diaper.contents = "wet";
    });

    const result = buildCandidate({ kind: "diaper", form, candidateId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field)).toContain("occurredAt");
  });

  it("keeps an unknown time unknown", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "unknown", instant: null };
      draft.diaper = { contents: "both", quantity: "a lot", note: "" };
    });

    const result = buildCandidate({ kind: "diaper", form, candidateId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.occurredAt).toBeNull();
    expect(result.candidate.timePrecision).toBe("unknown");
    expect(result.candidate.details).toEqual({
      kind: "diaper",
      contents: "both",
      quantity: "a lot",
    });
  });

  it("requires both ends of a reported sleep interval", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "earlier", instant: new Date("2026-09-06T08:00:00.000Z") };
      draft.sleep.state = "interval";
    });

    const missingEnd = buildCandidate({ kind: "sleep", form, candidateId });
    expect(missingEnd.ok).toBe(false);

    form.endOccurrence = { choice: "earlier", instant: new Date("2026-09-06T08:40:00.000Z") };
    const complete = buildCandidate({ kind: "sleep", form, candidateId });

    expect(complete.ok).toBe(true);
    if (!complete.ok) return;
    expect(complete.candidate.endedAt).toBe("2026-09-06T08:40:00.000Z");
  });

  it("does not record an end time for a reported sleep start", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "now", instant: new Date("2026-09-06T08:00:00.000Z") };
      draft.sleep.state = "started";
      draft.endOccurrence = { choice: "now", instant: new Date("2026-09-06T09:00:00.000Z") };
    });

    const result = buildCandidate({ kind: "sleep", form, candidateId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.endedAt).toBeNull();
  });

  it("keeps a planned note as a plan and never flags it as extracted", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "unknown", instant: null };
      draft.note = { text: "Give the new formula at 3", intent: "planned" };
    });

    const result = buildCandidate({ kind: "note", form, candidateId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.details).toEqual({
      kind: "note",
      text: "Give the new formula at 3",
      intent: "planned",
    });
    expect(result.candidate.ambiguities).toEqual([]);
    expect(result.candidate.sourceQuote).toBeNull();
    expect(result.candidate.discarded).toBe(false);
  });

  it("reports every missing note field at once", () => {
    const form = formWith((draft) => {
      draft.occurrence = { choice: "now", instant: new Date() };
    });

    const result = buildCandidate({ kind: "note", form, candidateId });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field).sort()).toEqual([
      "details.intent",
      "details.text",
    ]);
  });
});
