import type { DraftCandidate } from "@handoff/contracts";
import { describe, expect, it } from "vitest";

import { presentCandidate } from "./candidate-presentation";

const timezone = "Europe/Helsinki";
const capturedAt = new Date("2026-09-06T06:05:00.000Z");

function candidate(overrides: Partial<DraftCandidate> = {}): DraftCandidate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "feed",
    occurredAt: "2026-09-05T23:00:00.000Z",
    endedAt: null,
    timePrecision: "exact",
    amountValue: "60",
    amountUnit: "ml",
    details: { kind: "feed", method: "bottle" },
    important: false,
    sourceQuote: "Fed 60 ml at two",
    sourceStart: 0,
    sourceEnd: 16,
    ambiguities: [],
    discarded: false,
    ...overrides,
  };
}

describe("presentCandidate", () => {
  it("shows the amount, unit, and resolved reading as chips", () => {
    const presented = presentCandidate(candidate(), capturedAt, timezone);
    expect(presented.chips).toContainEqual({ label: "60 ml", tone: "neutral" });
    expect(presented.chips).toContainEqual({ label: "2026-09-06 02:00", tone: "neutral" });
    expect(presented.ambiguityPrompt).toBeUndefined();
  });

  it("marks an uncertain reading and asks the specific question", () => {
    const presented = presentCandidate(
      candidate({ ambiguities: ["date_unknown", "am_pm_unknown"] }),
      capturedAt,
      timezone,
    );
    expect(presented.chips).toContainEqual({ label: "2026-09-06 02:00", tone: "attention" });
    expect(presented.ambiguityPrompt).toBe("Which day was 02:00? Morning or afternoon?");
  });

  it("never turns a missing amount into a number", () => {
    const presented = presentCandidate(
      candidate({ amountValue: null, amountUnit: null, ambiguities: ["amount_unknown"] }),
      capturedAt,
      timezone,
    );
    expect(presented.chips).toContainEqual({ label: "Amount not stated", tone: "attention" });
    expect(presented.factText).toContain("amount not recorded");
  });

  it("keeps an unstated time unstated", () => {
    const presented = presentCandidate(
      candidate({ occurredAt: null, timePrecision: "unknown" }),
      capturedAt,
      timezone,
    );
    expect(presented.chips).toContainEqual({ label: "Time not given", tone: "neutral" });
  });

  it("surfaces negation, plans, and another child as their own chips", () => {
    const presented = presentCandidate(
      candidate({
        kind: "note",
        details: { kind: "note", text: "Give 60 ml later", intent: "planned" },
        amountValue: null,
        amountUnit: null,
        ambiguities: ["planned", "other_child"],
      }),
      capturedAt,
      timezone,
    );
    const labels = presented.chips.map((chip) => chip.label);
    expect(labels).toContain("Planned, not recorded care");
    expect(labels).toContain("Mentions another child");
  });
});
