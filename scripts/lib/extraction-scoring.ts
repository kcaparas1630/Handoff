// The scoring rules in docs/extraction-evaluation.md, as pure functions: candidate alignment,
// exact per-field comparison, the zero-invented-care check, word error rate, and the aggregation
// one mode's results reduce to. No clock, no provider, no filesystem.
import type {
  ExpectedCandidate,
  ExtractionCandidate,
  SpokenTimeComponents,
} from "../../packages/contracts/src/index";

export const TIME_COMPONENTS = ["hour", "minute", "meridiem", "dayOffset", "isNow"] as const;

/** The fields the 95% gate is measured on, reported one row each with its own denominator. */
export const CRITICAL_FIELDS: readonly string[] = [
  "kind",
  "amountValue",
  "amountUnit",
  ...TIME_COMPONENTS.map((component) => `spokenTime.${component}`),
  ...TIME_COMPONENTS.map((component) => `spokenEndTime.${component}`),
];

/** Reported per field, but they gate through the safety rules rather than through the 95%. */
export const SECONDARY_FIELDS: readonly string[] = [
  "negated",
  "planned",
  "mentionsOtherChild",
  "details.kind",
];

/** One scored field with its numerator and denominator; never a blended percentage. */
export interface FieldTally {
  matched: number;
  total: number;
}

export interface Mismatch {
  caseId: string;
  field: string;
  expected: string;
  produced: string;
}

export interface Violation {
  caseId: string;
  kind: string;
  amountValue: string | null;
}

export interface MustNotCreateRule {
  kind: string;
  amountValue?: string | null | undefined;
}

/** What one case produced. A blocked or failed case carries no scores, only its reason. */
export interface ScoredCase {
  caseId: string;
  tags: readonly string[];
  outcome: "scored" | "blocked" | "error";
  reason: string | null;
  fields: Record<string, FieldTally>;
  mismatches: Mismatch[];
  violations: Violation[];
  extras: number;
  missed: number;
  dropped: number;
  criticalCaseMatched: boolean;
  extractionMs: number | null;
  transcriptionMs: number | null;
  audioSeconds: number;
  wordErrorRate: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface ModeReport {
  mode: "transcript" | "audio";
  cases: number;
  scored: number;
  blocked: Record<string, number>;
  errors: { caseId: string; reason: string | null }[];
  fields: Record<string, FieldTally>;
  tags: Record<string, FieldTally>;
  extraCandidates: number;
  missedCandidates: number;
  droppedCandidates: number;
  violations: Violation[];
  mismatches: Mismatch[];
  latencyMs: Record<string, { p50: number; p95: number; samples: number }>;
  tokens: { input: number; output: number };
  costUsd: { extraction: number; transcription: number; total: number; perCase: number };
  transcript: { meanWordErrorRate: number; worst: { caseId: string; rate: number }[] } | null;
}

export interface Rates {
  anthropicInputUsdPerMTok: number;
  anthropicOutputUsdPerMTok: number;
  transcriptionUsdPerAudioSecond: number;
}

export function describe(value: unknown): string {
  if (value === undefined) return "absent";
  return JSON.stringify(value) ?? "null";
}

function tally(fields: Record<string, FieldTally>, field: string, isMatch: boolean): void {
  const entry = (fields[field] ??= { matched: 0, total: 0 });
  entry.total += 1;
  if (isMatch) entry.matched += 1;
}

/** `"60"` and `"60.0"` are one quantity; a value where the label is null is an invented one. */
export function amountsMatch(expected: string | null, produced: string | null): boolean {
  if (expected === null || produced === null) return expected === produced;
  return Number(expected) === Number(produced);
}

function scoreSpokenTime(
  caseId: string,
  prefix: string,
  expected: SpokenTimeComponents | null | undefined,
  produced: SpokenTimeComponents | null,
  fields: Record<string, FieldTally>,
  mismatches: Mismatch[],
): void {
  const want = expected ?? {};
  const got = produced ?? {};
  for (const component of TIME_COMPONENTS) {
    // Present-and-equal: an unstated component must come back absent, even where a guess would
    // have been plausible. Supplying one is a miss.
    const isMatch = want[component] === got[component];
    tally(fields, `${prefix}.${component}`, isMatch);
    if (isMatch) continue;
    mismatches.push({
      caseId,
      field: `${prefix}.${component}`,
      expected: describe(want[component]),
      produced: describe(got[component]),
    });
  }
}

/** How far apart two spoken readings are; an unstated component counts as its own distance. */
function timeDistance(
  expected: SpokenTimeComponents | null,
  produced: SpokenTimeComponents | null,
): number {
  const want = expected ?? {};
  const got = produced ?? {};
  let distance = 0;
  for (const component of TIME_COMPONENTS) {
    if (want[component] === got[component]) continue;
    distance += component === "hour" || component === "minute" ? 2 : 1;
  }
  return distance;
}

export interface Alignment {
  pairs: { expected: ExpectedCandidate; produced: ExtractionCandidate }[];
  extras: number;
  missed: number;
}

/**
 * Greedy alignment in fixture order: the same `kind` first, then the closest spoken reading, then
 * transcript order. A produced candidate is consumed once, so its source span decides the
 * remaining ties and two candidates of one kind align to two distinct quotes.
 */
export function alignCandidates(
  expected: readonly ExpectedCandidate[],
  produced: readonly ExtractionCandidate[],
): Alignment {
  const available = [...produced];
  const pairs: Alignment["pairs"] = [];
  let missed = 0;

  for (const want of expected) {
    let bestIndex = -1;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const [index, candidate] of available.entries()) {
      if (candidate.kind !== want.kind) continue;
      const rank =
        timeDistance(want.spokenTime, candidate.spokenTime) * 1e6 + candidate.sourceStart;
      if (rank >= bestRank) continue;
      bestRank = rank;
      bestIndex = index;
    }
    if (bestIndex === -1) {
      missed += 1;
      continue;
    }
    const [match] = available.splice(bestIndex, 1);
    if (match !== undefined) pairs.push({ expected: want, produced: match });
  }
  return { pairs, extras: available.length, missed };
}

/** Exact match or miss per field; no partial credit. False when any critical field missed. */
export function scorePair(
  caseId: string,
  pair: { expected: ExpectedCandidate; produced: ExtractionCandidate },
  fields: Record<string, FieldTally>,
  mismatches: Mismatch[],
): boolean {
  const { expected: want, produced: got } = pair;
  const simple: readonly [string, unknown, unknown, boolean][] = [
    ["kind", want.kind, got.kind, want.kind === got.kind],
    ["amountValue", want.amountValue, got.amountValue, amountsMatch(want.amountValue, got.amountValue)], // prettier-ignore
    ["amountUnit", want.amountUnit, got.amountUnit, want.amountUnit === got.amountUnit],
    ["negated", want.negated, got.negated, want.negated === got.negated],
    ["planned", want.planned, got.planned, want.planned === got.planned],
    ["mentionsOtherChild", want.mentionsOtherChild, got.mentionsOtherChild, want.mentionsOtherChild === got.mentionsOtherChild], // prettier-ignore
    ["details.kind", want.details.kind, got.details.kind, want.details.kind === got.details.kind],
  ];

  let criticalMatched = true;
  for (const [field, expected, produced, isMatch] of simple) {
    tally(fields, field, isMatch);
    if (isMatch) continue;
    mismatches.push({ caseId, field, expected: describe(expected), produced: describe(produced) });
    if (CRITICAL_FIELDS.includes(field)) criticalMatched = false;
  }

  const before = mismatches.length;
  scoreSpokenTime(caseId, "spokenTime", want.spokenTime, got.spokenTime, fields, mismatches);
  scoreSpokenTime(
    caseId,
    "spokenEndTime",
    want.spokenEndTime,
    got.spokenEndTime,
    fields,
    mismatches,
  );
  return criticalMatched && mismatches.length === before;
}

/**
 * The zero-invented-completed-care rule. A candidate violates it when a forbidden kind comes back
 * with `negated`, `planned`, and `mentionsOtherChild` all false, and matches the forbidden amount
 * where the rule names one (tests/fixtures/README.md).
 */
export function findViolations(
  caseId: string,
  rules: readonly MustNotCreateRule[],
  produced: readonly ExtractionCandidate[],
): Violation[] {
  const violations: Violation[] = [];
  for (const rule of rules) {
    for (const candidate of produced) {
      if (candidate.kind !== rule.kind) continue;
      if (candidate.negated || candidate.planned || candidate.mentionsOtherChild) continue;
      const amount = rule.amountValue ?? null;
      if (amount !== null && !amountsMatch(amount, candidate.amountValue)) continue;
      violations.push({ caseId, kind: rule.kind, amountValue: candidate.amountValue });
    }
  }
  return violations;
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "");
}

/** Word-level Levenshtein over the reference length, reported beside the audio field scores. */
export function wordErrorRate(expected: string, produced: string): number {
  const reference = normalizeWords(expected);
  const hypothesis = normalizeWords(produced);
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;

  let previous = Array.from({ length: hypothesis.length + 1 }, (_unused, index) => index);
  for (let row = 1; row <= reference.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= hypothesis.length; column += 1) {
      const swap = reference[row - 1] === hypothesis[column - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[column - 1] ?? 0) + swap,
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
        ),
      );
    }
    previous = current;
  }
  return (previous[hypothesis.length] ?? reference.length) / reference.length;
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** Folds one mode's cases into the report. Blocked and failed cases never enter a field score. */
export function summarize(
  mode: ModeReport["mode"],
  results: readonly ScoredCase[],
  rates: Rates,
): ModeReport {
  const fields: Record<string, FieldTally> = {};
  const tags: Record<string, FieldTally> = {};
  const blocked: Record<string, number> = {};
  const errors: ModeReport["errors"] = [];
  const violations: Violation[] = [];
  const mismatches: Mismatch[] = [];
  const extractionMs: number[] = [];
  const transcriptionMs: number[] = [];
  const rateSamples: { caseId: string; rate: number }[] = [];
  const totals = { extras: 0, missed: 0, dropped: 0, scored: 0, input: 0, output: 0, seconds: 0 };

  for (const result of results) {
    if (result.outcome === "blocked") {
      const reason = result.reason ?? "unknown";
      blocked[reason] = (blocked[reason] ?? 0) + 1;
      continue;
    }
    if (result.outcome === "error") {
      errors.push({ caseId: result.caseId, reason: result.reason });
      continue;
    }
    totals.scored += 1;
    totals.extras += result.extras;
    totals.missed += result.missed;
    totals.dropped += result.dropped;
    totals.input += result.inputTokens;
    totals.output += result.outputTokens;
    totals.seconds += result.audioSeconds;
    violations.push(...result.violations);
    mismatches.push(...result.mismatches);
    if (result.extractionMs !== null) extractionMs.push(result.extractionMs);
    if (result.transcriptionMs !== null) transcriptionMs.push(result.transcriptionMs);
    if (result.wordErrorRate !== null) {
      rateSamples.push({ caseId: result.caseId, rate: result.wordErrorRate });
    }
    for (const [field, entry] of Object.entries(result.fields)) {
      const target = (fields[field] ??= { matched: 0, total: 0 });
      target.matched += entry.matched;
      target.total += entry.total;
    }
    // A weak slice must stay visible, so each tag carries its own all-critical-fields-exact count.
    for (const tag of result.tags) {
      const target = (tags[tag] ??= { matched: 0, total: 0 });
      target.total += 1;
      if (result.criticalCaseMatched) target.matched += 1;
    }
  }

  const extraction =
    (totals.input / 1e6) * rates.anthropicInputUsdPerMTok +
    (totals.output / 1e6) * rates.anthropicOutputUsdPerMTok;
  const transcription = totals.seconds * rates.transcriptionUsdPerAudioSecond;

  return {
    mode,
    cases: results.length,
    scored: totals.scored,
    blocked,
    errors,
    fields,
    tags,
    extraCandidates: totals.extras,
    missedCandidates: totals.missed,
    droppedCandidates: totals.dropped,
    violations,
    mismatches,
    latencyMs: {
      transcription: {
        p50: percentile(transcriptionMs, 0.5),
        p95: percentile(transcriptionMs, 0.95),
        samples: transcriptionMs.length,
      },
      extraction: {
        p50: percentile(extractionMs, 0.5),
        p95: percentile(extractionMs, 0.95),
        samples: extractionMs.length,
      },
    },
    tokens: { input: totals.input, output: totals.output },
    costUsd: {
      extraction,
      transcription,
      total: extraction + transcription,
      perCase: totals.scored === 0 ? 0 : (extraction + transcription) / totals.scored,
    },
    transcript:
      rateSamples.length === 0
        ? null
        : {
            meanWordErrorRate:
              rateSamples.reduce((sum, item) => sum + item.rate, 0) / rateSamples.length,
            worst: [...rateSamples].sort((a, b) => b.rate - a.rate).slice(0, 5),
          },
  };
}
