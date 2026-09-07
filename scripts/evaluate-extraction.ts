// The milestone 3 extraction gate, measured. Implements docs/extraction-evaluation.md: it runs the
// real providers over the synthetic fixtures, scores every critical field exactly, and writes a
// JSON report plus a Markdown summary. It never prints a transcript or a provider request body.
//
//   pnpm eval:extraction -- --dry-run
//   pnpm eval:extraction -- --out docs/extraction-results/run.json
//   pnpm eval:extraction -- --audio tests/fixtures/audio/manifest.json --concurrency 2
//
// A scoring run costs real provider money. `--dry-run`, and a missing ANTHROPIC_API_KEY, print the
// corpus shape only: no provider is called and no accuracy number is produced.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { expectedCandidateSchema } from "../packages/contracts/src/index";
import { createAnthropicExtraction } from "../packages/server/src/ai/anthropic";
import { validateExtractionSemantics } from "../packages/server/src/ai/lib/validate-extraction";
import { PROMPT_VERSION } from "../packages/server/src/ai/prompts/extract-events-v1";
import { ProviderError } from "../packages/server/src/lib/provider-error";
import { PROVIDER_RATES } from "../packages/server/src/lib/provider-rates";
import { createDeepgramTranscription } from "../packages/server/src/transcription/deepgram";
import {
  CRITICAL_FIELDS,
  SECONDARY_FIELDS,
  alignCandidates,
  describe,
  findViolations,
  scorePair,
  summarize,
  wordErrorRate,
} from "./lib/extraction-scoring";
import type { ExtractionProvider } from "../packages/server/src/ai/extract-events";
import type { TranscriptionProvider } from "../packages/server/src/transcription/provider";
import type { FieldTally, Mismatch, ModeReport, Rates, ScoredCase } from "./lib/extraction-scoring";

// Provider prices live in packages/server/src/lib/provider-rates.ts, which is also what the
// runtime spend cap reads: a rate change cannot make a budget and a cost report disagree. The
// Deepgram figure there is still a placeholder, so every transcription cost below is an
// illustration until it is replaced with a contracted rate.
const RATES: Rates = PROVIDER_RATES;

const DEFAULT_CASES_PATH = "tests/fixtures/extraction-cases.jsonl";
const DEFAULT_AUDIO_MANIFEST_PATH = "tests/fixtures/audio/manifest.json";
const DEFAULT_MODEL_ID = "claude-opus-5";
const DEFAULT_TRANSCRIPTION_MODEL_ID = "nova-3";

const manifestEntrySchema = z.object({
  file: z.string().min(1),
  caseId: z.string().min(1),
  expectedTranscript: z.string(),
  durationMs: z.number().nonnegative().nullable(),
});

const caseSchema = z.object({
  id: z.string().min(1),
  transcript: z.string(),
  recordingStartedAt: z.iso.datetime(),
  timezone: z.string(),
  locale: z.string(),
  childAlias: z.string(),
  tags: z.array(z.string()),
  expected: z.object({
    candidates: z.array(expectedCandidateSchema),
    mustNotCreate: z.array(
      z.object({
        kind: z.string(),
        reason: z.string(),
        amountValue: z.string().nullable().optional(),
      }),
    ),
  }),
});

type EvaluationCase = z.infer<typeof caseSchema>;
type ManifestEntry = z.infer<typeof manifestEntrySchema>;

interface Options {
  casesPath: string;
  audioManifestPath: string | null;
  outPath: string;
  concurrency: number;
  isDryRun: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  let isDryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    // pnpm forwards its own `--` separator, so a bare one is not a flag.
    if (token === undefined || token === "--" || !token.startsWith("--")) continue;
    if (token === "--dry-run") {
      isDryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
    flags.set(token, value);
    index += 1;
  }
  const concurrency = Number(flags.get("--concurrency") ?? "2");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("--concurrency must be a whole number between 1 and 8");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    casesPath: flags.get("--cases") ?? DEFAULT_CASES_PATH,
    audioManifestPath: flags.get("--audio") ?? null,
    outPath: flags.get("--out") ?? path.join("docs", "extraction-results", `${stamp}.json`),
    concurrency,
    isDryRun,
  };
}

function loadCases(casesPath: string): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  for (const line of readFileSync(casesPath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    cases.push(caseSchema.parse(JSON.parse(line)));
  }
  return cases;
}

function loadManifest(manifestPath: string): ManifestEntry[] {
  return z.array(manifestEntrySchema).parse(JSON.parse(readFileSync(manifestPath, "utf8")));
}

/**
 * The whole `--dry-run` output. It describes the corpus and nothing else: no provider ran, so
 * there is deliberately no accuracy, cost, or latency figure here to mistake for a result.
 */
function printCorpus(cases: readonly EvaluationCase[], manifestPath: string): void {
  const guarded = cases.filter((item) => item.expected.mustNotCreate.length > 0).length;
  const counts = new Map<string, number>();
  for (const item of cases) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  console.info("Extraction evaluation, dry run. No provider was called and nothing was scored.");
  console.info(`  labelled cases:  ${String(cases.length)} (gate requires at least 50)`);
  console.info(
    `  audio clips:     ${String(loadManifest(manifestPath).length)} (gate requires at least 20)`,
  );
  console.info(`  mustNotCreate:   ${String(guarded)} cases carry a zero-invented-care rule`);
  console.info("  tag coverage:");
  const ordered = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [tag, count] of ordered) console.info(`    ${tag.padEnd(18)} ${String(count)}`);
}

async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = new Array<Result>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await run(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function unscored(
  item: EvaluationCase,
  outcome: ScoredCase["outcome"],
  reason: string,
): ScoredCase {
  return {
    caseId: item.id,
    tags: item.tags,
    outcome,
    reason,
    fields: {},
    mismatches: [],
    violations: [],
    extras: 0,
    missed: 0,
    dropped: 0,
    criticalCaseMatched: false,
    extractionMs: null,
    transcriptionMs: null,
    audioSeconds: 0,
    wordErrorRate: null,
    inputTokens: 0,
    outputTokens: 0,
  };
}

interface AudioInput {
  provider: TranscriptionProvider;
  entry: ManifestEntry;
  bytes: Buffer;
}

/**
 * One case end to end: transcribe when a clip is supplied, then extract from whatever transcript
 * the pipeline really has. A response that fails the schema or the domain rules is recorded as
 * blocked and never scored, which is what the gate requires of the pipeline itself.
 */
async function evaluateCase(
  item: EvaluationCase,
  extraction: ExtractionProvider,
  audio: AudioInput | null,
): Promise<ScoredCase> {
  let transcript = item.transcript;
  let transcriptionMs: number | null = null;
  let audioSeconds = 0;
  let rate: number | null = null;

  try {
    if (audio !== null) {
      const startedAt = Date.now();
      const spoken = await audio.provider.transcribe({
        audio: audio.bytes,
        mime: "audio/wav",
        language: "en",
      });
      transcriptionMs = Date.now() - startedAt;
      transcript = spoken.transcript;
      audioSeconds = (spoken.durationMs ?? audio.entry.durationMs ?? 0) / 1000;
      rate = wordErrorRate(audio.entry.expectedTranscript, spoken.transcript);
    }

    const extracted = await extraction.extract({
      schemaVersion: 1,
      rawTranscript: transcript,
      recordingStartedAt: item.recordingStartedAt,
      timezone: item.timezone,
      locale: item.locale,
      childAlias: item.childAlias,
      promptVersion: PROMPT_VERSION,
    });

    const validated = validateExtractionSemantics(extracted.output, transcript);
    if (!validated.ok) return unscored(item, "blocked", validated.reason);

    const alignment = alignCandidates(item.expected.candidates, validated.value.candidates);
    const fields: Record<string, FieldTally> = {};
    const mismatches: Mismatch[] = [];
    let criticalCaseMatched = alignment.extras === 0 && alignment.missed === 0;
    for (const pair of alignment.pairs) {
      if (!scorePair(item.id, pair, fields, mismatches)) criticalCaseMatched = false;
    }

    return {
      caseId: item.id,
      tags: item.tags,
      outcome: "scored",
      reason: null,
      fields,
      mismatches,
      violations: findViolations(item.id, item.expected.mustNotCreate, validated.value.candidates),
      extras: alignment.extras,
      missed: alignment.missed,
      dropped: validated.value.droppedCount,
      criticalCaseMatched,
      extractionMs: extracted.provenance.durationMs,
      transcriptionMs,
      audioSeconds,
      wordErrorRate: rate,
      inputTokens: extracted.provenance.inputTokens,
      outputTokens: extracted.provenance.outputTokens,
    };
  } catch (error) {
    // A refusal or an unparsable response is invalid output the adapter already blocked; any
    // other provider failure is a run problem, not a measurement.
    if (error instanceof ProviderError && error.code === "invalid_input") {
      return unscored(item, "blocked", `${error.provider}_invalid_output`);
    }
    const code = error instanceof ProviderError ? `${error.provider}_${error.code}` : "unexpected";
    return unscored(item, "error", code);
  }
}

function formatRow(field: string, entry: FieldTally | undefined): string {
  if (entry === undefined || entry.total === 0) return `| \`${field}\` | — | 0 / 0 |`;
  const percent = ((entry.matched / entry.total) * 100).toFixed(1);
  return `| \`${field}\` | ${percent}% | ${String(entry.matched)} / ${String(entry.total)} |`;
}

function fieldTable(title: string, names: readonly string[], report: ModeReport): string[] {
  return [
    "",
    `### ${title}`,
    "",
    "| Field | Exact | Matched / total |",
    "| --- | --- | --- |",
    ...names.map((field) => formatRow(field, report.fields[field])),
  ];
}

/** Case ids and field-level values only; a transcript never reaches stdout or the artifact. */
function printMarkdown(report: ModeReport): void {
  const blockedTotal = Object.values(report.blocked).reduce((sum, count) => sum + count, 0);
  const lines = [
    `## ${report.mode} mode`,
    "",
    `Cases ${String(report.cases)}, scored ${String(report.scored)}, blocked ${String(blockedTotal)}, run errors ${String(report.errors.length)}.`,
    ...fieldTable("Critical fields", CRITICAL_FIELDS, report),
    ...fieldTable("Reported, but not part of the 95% figure", SECONDARY_FIELDS, report),
    ...fieldTable(
      "Per tag (cases whose every critical field was exact)",
      Object.keys(report.tags).sort((a, b) => a.localeCompare(b)),
      { ...report, fields: report.tags },
    ),
    "",
    "### Candidates and safety rules",
    "",
    `- extra candidates: ${String(report.extraCandidates)}`,
    `- missed candidates: ${String(report.missedCandidates)}`,
    `- candidates dropped before the draft: ${String(report.droppedCandidates)}`,
    `- invented completed care (mustNotCreate violations): ${String(report.violations.length)}`,
    `- blocked responses: ${String(blockedTotal)} ${JSON.stringify(report.blocked)}; none of them reached a draft`,
    ...report.violations.map(
      (violation) =>
        `  - ${violation.caseId}: ${violation.kind} amountValue=${describe(violation.amountValue)}`,
    ),
    ...report.errors.map((failure) => `  - run error ${failure.caseId}: ${failure.reason ?? ""}`),
    "",
    "### Latency and cost",
    "",
    "| Stage | p50 ms | p95 ms | samples |",
    "| --- | --- | --- | --- |",
    ...Object.entries(report.latencyMs).map(
      ([stage, entry]) =>
        `| ${stage} | ${String(entry.p50)} | ${String(entry.p95)} | ${String(entry.samples)} |`,
    ),
    "",
    `- tokens: ${String(report.tokens.input)} in, ${String(report.tokens.output)} out`,
    `- extraction cost: US$${report.costUsd.extraction.toFixed(4)}`,
    `- transcription cost: US$${report.costUsd.transcription.toFixed(4)} (PLACEHOLDER rate)`,
    `- per scored case: US$${report.costUsd.perCase.toFixed(4)}`,
  ];

  if (report.transcript !== null) {
    lines.push(
      "",
      `- mean word error rate: ${(report.transcript.meanWordErrorRate * 100).toFixed(1)}%`,
      ...report.transcript.worst.map(
        (worst) => `  - ${worst.caseId}: ${(worst.rate * 100).toFixed(1)}%`,
      ),
    );
  }
  if (report.mismatches.length > 0) {
    lines.push(
      "",
      "### Field mismatches",
      "",
      ...report.mismatches.map(
        (item) =>
          `- ${item.caseId} \`${item.field}\`: expected ${item.expected}, produced ${item.produced}`,
      ),
    );
  }
  console.info(lines.join("\n"));
}

async function runAudioMode(
  options: Options,
  cases: readonly EvaluationCase[],
  manifest: readonly ManifestEntry[],
  extraction: ExtractionProvider,
): Promise<ModeReport> {
  const apiKey = process.env.DEEPGRAM_API_KEY ?? "";
  if (apiKey === "") throw new Error("DEEPGRAM_API_KEY must be set to run audio mode");
  const provider = createDeepgramTranscription({
    apiKey,
    modelId: process.env.TRANSCRIPTION_MODEL_ID ?? DEFAULT_TRANSCRIPTION_MODEL_ID,
  });
  // Manifest paths are relative to the fixtures root, which is the manifest's parent's parent.
  const root = path.dirname(path.dirname(options.audioManifestPath ?? DEFAULT_AUDIO_MANIFEST_PATH));
  const byId = new Map(cases.map((item) => [item.id, item]));
  const clips = manifest.flatMap((entry) => {
    const item = byId.get(entry.caseId);
    return item === undefined ? [] : [{ item, entry }];
  });
  const results = await mapWithConcurrency(clips, options.concurrency, ({ item, entry }) =>
    evaluateCase(item, extraction, {
      provider,
      entry,
      bytes: readFileSync(path.join(root, entry.file)),
    }),
  );
  return summarize("audio", results, RATES);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const cases = loadCases(options.casesPath);

  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (options.isDryRun || apiKey === "") {
    if (!options.isDryRun) {
      console.info("ANTHROPIC_API_KEY is not set, so no provider was called.");
    }
    // Audio mode still needs `--audio`, but the clip count is part of the corpus either way.
    printCorpus(cases, options.audioManifestPath ?? DEFAULT_AUDIO_MANIFEST_PATH);
    return;
  }

  const modelId = process.env.ANTHROPIC_MODEL_ID ?? DEFAULT_MODEL_ID;
  const extraction = createAnthropicExtraction({ apiKey, modelId });
  const transcriptResults = await mapWithConcurrency(cases, options.concurrency, (item) =>
    evaluateCase(item, extraction, null),
  );
  const modes: ModeReport[] = [summarize("transcript", transcriptResults, RATES)];

  // Audio mode is reported on its own so a transcription regression is never averaged into the
  // extraction figures (docs/extraction-evaluation.md, "Audio versus transcript").
  if (options.audioManifestPath !== null) {
    const manifest = loadManifest(options.audioManifestPath);
    modes.push(await runAudioMode(options, cases, manifest, extraction));
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    extractionModelId: modelId,
    transcriptionModelId: process.env.TRANSCRIPTION_MODEL_ID ?? DEFAULT_TRANSCRIPTION_MODEL_ID,
    rates: RATES,
    modes,
  };
  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  for (const report of modes) printMarkdown(report);
  console.info(`\nReport written to ${options.outPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "the evaluation failed");
  process.exit(1);
});
