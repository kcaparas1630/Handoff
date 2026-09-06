import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { eventKindSchema } from "./events";
import {
  expectedCandidateSchema,
  extractionCandidateSchema,
  extractionOutputSchema,
} from "./extraction";

// A labelled fixture line. The evaluator in scripts/ reads the same file, so a malformed case
// fails here rather than silently skewing an accuracy report.
const fixtureCaseSchema = z
  .object({
    id: z.string().regex(/^ex-\d{3}$/),
    transcript: z.string().min(1),
    recordingStartedAt: z.iso.datetime(),
    timezone: z.string().min(1),
    locale: z.string().min(2),
    childAlias: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    expected: z
      .object({
        candidates: z.array(expectedCandidateSchema),
        mustNotCreate: z.array(
          z
            .object({
              kind: eventKindSchema,
              amountValue: z.string().min(1).optional(),
              reason: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

const fixturePath = new URL("../../../../tests/fixtures/extraction-cases.jsonl", import.meta.url);
const lines = readFileSync(fixturePath, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0);

describe("extraction fixtures", () => {
  it("has at least the 50 labelled cases the milestone 3 gate requires", () => {
    expect(lines.length).toBeGreaterThanOrEqual(50);
  });

  it("parses every line as a labelled case", () => {
    const failures: string[] = [];
    for (const [index, line] of lines.entries()) {
      const parsed = fixtureCaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) failures.push(`line ${index + 1}: ${parsed.error.message}`);
    }
    expect(failures).toEqual([]);
  });

  it("uses unique ids and covers every event kind", () => {
    const cases = lines.map((line) => fixtureCaseSchema.parse(JSON.parse(line)));
    const ids = cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    const kinds = new Set(cases.flatMap((entry) => entry.expected.candidates.map((c) => c.kind)));
    expect([...kinds].sort()).toEqual(["diaper", "feed", "milestone", "note", "sleep"]);
  });

  it("keeps an amount out of every kind that cannot carry one", () => {
    const cases = lines.map((line) => fixtureCaseSchema.parse(JSON.parse(line)));
    const offenders = cases.flatMap((entry) =>
      entry.expected.candidates
        .filter((c) => c.kind !== "feed" && (c.amountValue !== null || c.amountUnit !== null))
        .map(() => entry.id),
    );
    expect(offenders).toEqual([]);
  });
});

const MODEL_CANDIDATE = {
  kind: "feed",
  spokenTime: { hour: 2, meridiem: "am" },
  spokenEndTime: null,
  amountValue: "60",
  amountUnit: "ml",
  details: { kind: "feed", method: "bottle" },
  sourceQuote: "Fed him 60 ml from a bottle at 2 am",
  sourceStart: 0,
  sourceEnd: 34,
  ambiguities: ["date_unknown"],
  negated: false,
  planned: false,
  mentionsOtherChild: false,
};

describe("extractionCandidate", () => {
  it("accepts spoken components without an absolute instant", () => {
    expect(extractionCandidateSchema.safeParse(MODEL_CANDIDATE).success).toBe(true);
  });

  it("rejects a model-supplied identifier", () => {
    const parsed = extractionCandidateSchema.safeParse({
      ...MODEL_CANDIDATE,
      id: "6f1d2d0e-5d3f-4a8f-9c9b-0f8f8b6d1a11",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a model-chosen occurrence instant", () => {
    const parsed = extractionCandidateSchema.safeParse({
      ...MODEL_CANDIDATE,
      occurredAt: "2026-09-05T09:00:00.000Z",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a source span that does not advance", () => {
    const parsed = extractionCandidateSchema.safeParse({
      ...MODEL_CANDIDATE,
      sourceStart: 10,
      sourceEnd: 10,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("extractionOutput", () => {
  it("accepts an empty result for silence", () => {
    const parsed = extractionOutputSchema.safeParse({
      schemaVersion: 1,
      formattedText: "",
      candidates: [],
      notes: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects more candidates than one recording may produce", () => {
    const parsed = extractionOutputSchema.safeParse({
      schemaVersion: 1,
      formattedText: "",
      candidates: Array.from({ length: 21 }, () => MODEL_CANDIDATE),
      notes: [],
    });
    expect(parsed.success).toBe(false);
  });
});
