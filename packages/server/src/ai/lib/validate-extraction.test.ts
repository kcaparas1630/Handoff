import { describe, expect, it } from "vitest";
import { DROPPED_CANDIDATE_NOTE, validateExtractionSemantics } from "./validate-extraction";
import type { ExtractionCandidate, ExtractionOutput } from "@handoff/contracts";

const TRANSCRIPT = "Fed 60 ml at 2 am.";

function candidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return {
    kind: "feed",
    spokenTime: { hour: 2, meridiem: "am" },
    spokenEndTime: null,
    amountValue: "60",
    amountUnit: "ml",
    details: { kind: "feed", method: "bottle" },
    sourceQuote: TRANSCRIPT,
    sourceStart: 0,
    sourceEnd: TRANSCRIPT.length,
    ambiguities: [],
    negated: false,
    planned: false,
    mentionsOtherChild: false,
    ...overrides,
  };
}

function output(candidates: ExtractionCandidate[], notes: string[] = []): ExtractionOutput {
  return { schemaVersion: 1, formattedText: TRANSCRIPT, candidates, notes };
}

describe("validateExtractionSemantics", () => {
  it("keeps a candidate whose quote is exactly where it says it is", () => {
    const result = validateExtractionSemantics(output([candidate()]), TRANSCRIPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(1);
    expect(result.value.droppedCount).toBe(0);
  });

  it("drops a quote that is not the text at those offsets", () => {
    const moved = candidate({ sourceStart: 4, sourceEnd: 6 });
    const result = validateExtractionSemantics(output([moved, candidate()]), TRANSCRIPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(1);
    expect(result.value.notes).toContain(DROPPED_CANDIDATE_NOTE);
  });

  it("drops a span that runs past the end of the transcript", () => {
    const overrun = candidate({ sourceEnd: TRANSCRIPT.length + 5 });
    const result = validateExtractionSemantics(output([overrun]), TRANSCRIPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
    expect(result.value.droppedCount).toBe(1);
  });

  it("drops details that describe a different kind of event", () => {
    const mismatched = candidate({
      kind: "diaper",
      details: { kind: "feed", method: "bottle" },
    });
    const result = validateExtractionSemantics(output([mismatched]), TRANSCRIPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
  });

  it("drops an amount on a kind that records none, and a unit without its value", () => {
    const amountOnDiaper = candidate({
      kind: "diaper",
      details: { kind: "diaper", contents: "wet" },
    });
    const unitWithoutAmount = candidate({ amountValue: null });
    const result = validateExtractionSemantics(
      output([amountOnDiaper, unitWithoutAmount]),
      TRANSCRIPT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(0);
    expect(result.value.droppedCount).toBe(2);
  });

  it("keeps a sleep interval, whose times are resolved after this check", () => {
    const sleep = candidate({
      kind: "sleep",
      details: { kind: "sleep", state: "interval" },
      amountValue: null,
      amountUnit: null,
      spokenEndTime: { hour: 3 },
    });
    const result = validateExtractionSemantics(output([sleep]), TRANSCRIPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toHaveLength(1);
  });

  it("rejects the whole response when it exceeds the candidate cap", () => {
    const many = Array.from({ length: 21 }, () => candidate());
    const result = validateExtractionSemantics(output(many), TRANSCRIPT);
    expect(result.ok).toBe(false);
  });

  it("keeps at most five notes, including the one it adds", () => {
    const notes = ["a", "b", "c", "d", "e"];
    const result = validateExtractionSemantics(
      output([candidate({ sourceEnd: TRANSCRIPT.length + 1 })], notes),
      TRANSCRIPT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.notes).toHaveLength(5);
  });
});
