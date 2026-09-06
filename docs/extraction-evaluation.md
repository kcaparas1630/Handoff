# Extraction evaluation

How the milestone 3 extraction gate in [the roadmap](implementation-roadmap.md) is measured. This
document defines the procedure and the scoring rules only. **No results have been produced yet**;
do not add numbers here that a run did not actually generate.

## Inputs

| Input | Location | Notes |
| --- | --- | --- |
| Labelled transcript cases | `tests/fixtures/extraction-cases.jsonl` | One JSON object per line; 56 cases today, gate requires ≥50 |
| Synthetic recordings | `tests/fixtures/audio/*.wav` + `audio/manifest.json` | 20 clips, each referencing a case id |
| Labelling rules and provenance | `tests/fixtures/README.md` | Everything is synthetic and hand-authored |

Expected values encode only what was explicitly spoken. A date the speaker never stated is an
ambiguity flag, not a ground-truth fact ([architecture](architecture.md) §4). Nothing in the
fixtures is scored as if the extractor should have inferred it.

## Running it

`scripts/evaluate-extraction.ts` implements this document; the scoring rules themselves live in
`scripts/lib/extraction-scoring.ts` as pure functions.

```bash
# Corpus only. No provider is called and nothing is scored.
pnpm eval:extraction -- --dry-run

# Transcript mode: feed each case's `transcript` straight to the extractor.
ANTHROPIC_API_KEY=... pnpm eval:extraction -- --out docs/extraction-results/run.json

# Adds audio mode: transcribe each manifest clip, then extract from that real transcript.
ANTHROPIC_API_KEY=... DEEPGRAM_API_KEY=... pnpm eval:extraction -- --audio tests/fixtures/audio/manifest.json
```

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Print the case count and per-tag coverage, then exit. Calls no provider and prints no accuracy number |
| `--cases <path>` | The labelled corpus; defaults to `tests/fixtures/extraction-cases.jsonl` |
| `--audio <path>` | Runs audio mode over a manifest as well. Omitted, only transcript mode runs |
| `--out <path>` | The JSON run artifact; defaults to `docs/extraction-results/<timestamp>.json`. The folder is created |
| `--concurrency <n>` | Cases in flight per mode, 1–8; defaults to 2 |

Transcript mode always runs; audio mode is added by `--audio` and reported separately. Both call
real providers, so they need `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL_ID` (and `DEEPGRAM_API_KEY`/
`TRANSCRIPTION_MODEL_ID` for audio) and a cost budget, and they are not part of `pnpm test:unit`.
A missing `ANTHROPIC_API_KEY` behaves like `--dry-run` rather than failing part way through a run.
`pnpm test:unit` only validates that every fixture line still parses against
`expectedCandidateSchema`, which keeps a malformed case from reaching a scoring run.

The run prints case ids and field-level mismatches. It never prints a transcript, a clip, or a
provider request body, and the JSON artifact holds none of them either.

### Audio versus transcript

The two modes are reported separately and never merged into one figure. Transcript mode isolates
the Anthropic extraction step. Audio mode adds the speech-to-text provider in front of it, so a
drop between the two is attributable to transcription rather than extraction — that separation is
an explicit gate requirement. Report the word-level transcript comparison against the manifest's
`expectedTranscript` alongside the audio-mode field scores so a transcription regression is visible
on its own.

The clips are Windows SAPI machine voices. Audio-mode numbers describe the pipeline, not accent,
noise, or far-field robustness, and no result from them may be reported as general speech accuracy.

## Matching candidates

Scoring compares the extractor's candidates for a case against `expected.candidates`.

1. Match on `kind`, then on the closest spoken time, then in transcript order. A candidate that
   cannot be matched is an **extra**; an expected candidate with no match is a **miss**.
2. Extras and misses are counted and reported per case; they are never averaged away into the
   field scores.
3. Field accuracy is computed only over matched pairs, so the two counts must be read together.

## Per-field scoring

Each field is scored as exact match or miss. There is no partial credit.

| Field | Rule |
| --- | --- |
| `kind` | Exact enum match |
| `amountValue` | Exact decimal-string match, including `null`. `"60"` and `"60.0"` are compared numerically; a produced value where the label is `null` is an invented quantity |
| `amountUnit` | Exact enum match, including `null`. The stated unit is preserved, never normalised (`oz` is not converted to `ml`) |
| Explicit time components | `spokenTime` and `spokenEndTime` compared field by field (`hour`, `minute`, `meridiem`, `dayOffset`, `isNow`). An unstated component must be absent; supplying one is a miss even if it would have been a plausible guess |
| `negated` | Exact boolean match |
| `planned` | Exact boolean match |
| `mentionsOtherChild` | Exact boolean match |
| `ambiguities` | Set comparison, reported separately as a secondary signal |

**Critical fields** are `kind`, `amountValue`, `amountUnit`, and the explicit time components. The
gate is **≥95% exact accuracy across critical fields on the labelled fixtures**, reported per field
with its numerator and denominator, not as a single blended percentage. `negated`, `planned`, and
`mentionsOtherChild` are reported per field as well; they gate through the safety rules below
rather than through the 95% figure.

`ambiguities` is scored but is not a critical field: a flag the reviewer sees is a prompt for a
question, not a claimed fact. Missing `negation`, `planned`, or `other_child` still fails through
`mustNotCreate`.

## Safety rules that are not percentages

These are pass/fail. A single violation fails the gate regardless of the aggregate score.

- **Zero invented quantities.** No candidate may carry an `amountValue` the transcript does not
  state. Cases tagged `missing-amount` and `missing-unit` exist for exactly this.
- **Zero invented completed care.** Every `mustNotCreate` entry must hold: no candidate of that
  kind may come back with `negated`, `planned`, and `mentionsOtherChild` all false (and matching
  `amountValue` where the entry specifies one). This covers negation, future plans, corrected
  amounts, and another child's name. See `tests/fixtures/README.md` for the exact semantics.
- **100% of malformed or semantically invalid output is blocked.** Anything that fails
  `extractionOutputSchema` or the domain rules in `packages/domain/src/lib/event-rules.ts` must be
  rejected before it reaches a draft, and the run records it as a blocked response rather than a
  scored candidate.
- **Date proposals are reviewable, not ground truth.** A proposed calendar day for a spoken clock
  reading is never counted as a correct or incorrect speech fact. Daylight-saving behaviour is
  asserted against `resolveEventTime` in the domain unit tests, not against the model.

## Confidence is not a metric

Any self-reported confidence, certainty, or probability from the model is ignored. It is not
collected, not reported, and never used to weight a score or to skip review. Accuracy is measured
only against the hand-labelled fixtures.

## Reporting

A run produces, for each mode:

- Per-critical-field exact accuracy with counts, plus the `negated`/`planned`/`mentionsOtherChild`
  field counts.
- Extra and missed candidate counts.
- Every `mustNotCreate` violation, listed individually with its case id.
- Blocked-response count with the validation error class.
- Per-tag breakdown (`negation`, `planned`, `multi-event`, `ampm-ambiguity`, `midnight`, `dst`,
  `other-child`, `silence`, `unit-variant`, `number-words`, …) so a weak slice is not hidden by an
  aggregate.
- Model id, prompt version, and provider/model for transcription, from
  `extractionProvenanceSchema`, so a result is attributable to a pinned configuration.

Store the report as a run artifact with its date and configuration. Do not paste unverified numbers
into this file or into the roadmap.

## Status

`scripts/evaluate-extraction.ts` exists and has been run **in dry-run mode only**: 56 labelled
cases and 20 audio clips loaded, tag coverage printed, no provider called.

No live run has happened. Nobody has held an Anthropic or Deepgram key for this repository, so
every measured gate in the roadmap's milestone 3 acceptance list remains **unmeasured**:

- the >=95% exact accuracy across critical fields,
- the zero-invented-quantity and zero-invented-completed-care counts,
- the 100%-blocked figure for malformed or semantically invalid output,
- the audio-versus-transcript separation and the word error rate,
- the p50/p95 stage latencies and the stop-to-review target,
- the per-recording ASR + LLM cost against the US$0.02 budget.

The script computes all of them, but a computed formula is not a result. The Deepgram rate the
cost figures use is a named placeholder constant, not a contracted price; replace it before any
cost number is quoted. Do not record a number in this file, in the roadmap, or in a review until
someone runs the script with real keys and attaches the artifact it writes.
