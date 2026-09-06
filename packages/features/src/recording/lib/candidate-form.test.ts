import type { DraftCandidate } from "@handoff/contracts";
import { describe, expect, it } from "vitest";

import {
  candidateFromForm,
  candidateWithOccurredAt,
  entryFormFromCandidate,
} from "./candidate-form";

function candidate(overrides: Partial<DraftCandidate> = {}): DraftCandidate {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "feed",
    occurredAt: "2026-09-05T23:00:00.000Z",
    endedAt: null,
    timePrecision: "exact",
    amountValue: null,
    amountUnit: null,
    details: { kind: "feed", method: "bottle" },
    important: false,
    sourceQuote: "Fed at two",
    sourceStart: 0,
    sourceEnd: 10,
    ambiguities: ["amount_unknown", "date_unknown"],
    discarded: false,
    ...overrides,
  };
}

describe("entryFormFromCandidate", () => {
  it("loads the recorded values without inventing a missing amount", () => {
    const form = entryFormFromCandidate(candidate());
    expect(form.feed.amountText).toBe("");
    expect(form.feed.method).toBe("bottle");
    expect(form.occurrence.choice).toBe("earlier");
  });

  it("keeps an unstated time unanswered rather than defaulting to now", () => {
    const form = entryFormFromCandidate(candidate({ occurredAt: null, timePrecision: "unknown" }));
    expect(form.occurrence).toEqual({ choice: "unknown", instant: null });
  });
});

describe("candidateFromForm", () => {
  it("preserves the id and source span while applying the correction", () => {
    const original = candidate();
    const form = entryFormFromCandidate(original);
    form.feed = { ...form.feed, amountText: "90", amountUnit: "ml" };

    const result = candidateFromForm(original, form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.id).toBe(original.id);
    expect(result.candidate.sourceStart).toBe(0);
    expect(result.candidate.amountValue).toBe("90");
    // The caregiver has now stated the amount and the time, so those questions are answered.
    expect(result.candidate.ambiguities).toEqual([]);
  });

  it("keeps a flag the edit does not answer", () => {
    const original = candidate({ ambiguities: ["planned"] });
    const form = entryFormFromCandidate(original);
    const result = candidateFromForm(original, form);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.ambiguities).toEqual(["planned"]);
  });

  it("reports the same field errors the server would", () => {
    const original = candidate();
    const form = entryFormFromCandidate(original);
    form.feed = { ...form.feed, amountText: "0" };
    const result = candidateFromForm(original, form);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.field === "amountValue")).toBe(true);
  });
});

describe("candidateWithOccurredAt", () => {
  it("clears only the time questions once the reading is confirmed", () => {
    const updated = candidateWithOccurredAt(
      candidate({ ambiguities: ["date_unknown", "am_pm_unknown", "planned"] }),
      new Date("2026-09-05T11:00:00.000Z"),
    );
    expect(updated.occurredAt).toBe("2026-09-05T11:00:00.000Z");
    expect(updated.timePrecision).toBe("exact");
    expect(updated.ambiguities).toEqual(["planned"]);
  });
});
