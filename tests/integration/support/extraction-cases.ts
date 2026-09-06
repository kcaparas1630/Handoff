// The labelled corpus in tests/fixtures/extraction-cases.jsonl, loaded so the pipeline tests are
// grounded in the same synthetic material the extraction evaluation uses. The expectations were
// authored independently of the extractor; nothing here derives them from it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExpectedCandidate, ExtractionOutput } from "../../../packages/contracts/src/index";

export interface ExtractionCase {
  id: string;
  transcript: string;
  recordingStartedAt: string;
  timezone: string;
  locale: string;
  childAlias: string;
  tags: string[];
  expected: { candidates: ExpectedCandidate[] };
}

const casesPath = fileURLToPath(new URL("../../fixtures/extraction-cases.jsonl", import.meta.url));

let loaded: Map<string, ExtractionCase> | null = null;

export function loadExtractionCases(): Map<string, ExtractionCase> {
  if (loaded !== null) return loaded;
  const cases = new Map<string, ExtractionCase>();
  for (const line of readFileSync(casesPath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line) as ExtractionCase;
    cases.set(parsed.id, parsed);
  }
  loaded = cases;
  return cases;
}

export function extractionCase(id: string): ExtractionCase {
  const found = loadExtractionCases().get(id);
  if (found === undefined) throw new Error(`unknown extraction fixture: ${id}`);
  return found;
}

/**
 * Maps a fixture's labelled candidates onto the provider output shape. The fixtures record only
 * what was spoken, so the source span every candidate needs is the whole transcript: the tests
 * that care about spans set their own.
 */
export function outputForCase(fixture: ExtractionCase): ExtractionOutput {
  return {
    schemaVersion: 1,
    formattedText: fixture.transcript,
    candidates: fixture.expected.candidates.map((candidate) => ({
      kind: candidate.kind,
      spokenTime: candidate.spokenTime,
      spokenEndTime: candidate.spokenEndTime ?? null,
      amountValue: candidate.amountValue,
      amountUnit: candidate.amountUnit,
      details: candidate.details,
      sourceQuote: fixture.transcript,
      sourceStart: 0,
      sourceEnd: fixture.transcript.length,
      ambiguities: candidate.ambiguities,
      negated: candidate.negated,
      planned: candidate.planned,
      mentionsOtherChild: candidate.mentionsOtherChild,
    })),
    notes: [],
  };
}
