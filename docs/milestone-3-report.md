# Milestone 3 report: voice capture, durable processing, human review

Completed September 6, 2026. Measured against the [roadmap](implementation-roadmap.md)
milestone 3 gate. This milestone has more unmeasured gates than the first two because every
provider (Deepgram, Anthropic, Supabase Storage) and every device path needs credentials or
hardware that were not available. Nothing below claims a live provider call happened.

## User-visible behavior implemented

- A labelled Record update control on the child dashboard with a rotating example, explicit
  microphone permission explanation, a Type instead path, elapsed time and level during
  recording, Stop and Cancel, and a 60-second limit.
- Recordings are saved to app document storage first, then walked through a durable outbox:
  create capture, upload to a signed URL, complete, poll. Kill and reopen resumes from the last
  committed stage; another account's recordings are never uploaded.
- A review screen with truthful states (saved on this phone, uploading, preparing your update,
  ready for review, failed with retry or manual entry), editable draft cards, day and AM/PM
  chips for uncertain times, reviewer notes, a collapsible transcript, and Save N updates.
- Server: audio and text captures, storage quota reservation, signed upload authorization, upload
  completion that verifies the object, a leased Postgres job queue with a separate dispatcher
  role, a worker that transcribes, checkpoints, runs one structured-output extraction call, and
  commits a reviewable draft only if the capture version and lease are still current.
- Confirmation from milestone 2 remains the only path that creates events.

## Paths changed

Contracts (`extraction`, `media`, `media-limits`, capture DTO additions), database
(`media_assets`, `jobs`, storage quota, migrations `0004`/`0005`), server (`storage/`,
`transcription/`, `ai/`, `jobs/`, `services/uploads.ts`), `apps/worker`, mobile
(`audio/`, `outbox/`, recording store), features (`recording/`), UI (`RecordButton`,
`DraftEventCard`), API routes (`complete`, `retry`), fixtures, `scripts/evaluate-extraction.ts`,
`scripts/provision-storage.ts`, `scripts/generate-audio-fixtures.ps1`. Commits `48cd9f9`
through the routes commit on `main`.

Manifest deviations: `scripts/lib/extraction-scoring.ts` holds the pure scoring; the worker's
draft building lives in `jobs/lib/draft-candidates.ts`; `services/capture-uploads.ts` and
`lib/provider-error.ts` were added; hand edits to generated migration `0004` are listed in
`packages/db/migrations/README.md`.

## Commands run and results

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` (13 projects), `pnpm format:check` | Clean |
| `pnpm test:unit` | 277 passed |
| `DATABASE_URL=… pnpm test:integration` | 185 passed, 1 skipped (opt-in performance) |
| `pnpm build:api` | 23 routes exported |
| `pnpm eval:extraction -- --dry-run` | 56 labelled cases, 20 audio clips, 45 tags; no provider called |
| Native exports | Both apps bundle with the recorder and outbox |

## Acceptance gate status

| Gate item | Status | Evidence or gap |
| --- | --- | --- |
| At least 50 labelled transcript fixtures and 20 synthetic audio clips covering every listed case | Verified | 56 cases, 20 SAPI-synthesized WAV clips with a manifest; see `tests/fixtures/README.md` |
| ≥95% exact accuracy on explicit critical fields, per-field results | Not measured | `scripts/evaluate-extraction.ts` implements the scoring; no Anthropic key was available. Dry run only |
| Zero invented quantities from negation and future fixtures; 100% invalid output blocked | Partial | Blocking is verified with fakes: malformed output fails the job, out-of-range quotes are dropped with a note, refusals are terminal. The live model behaviour is unmeasured |
| Transcript extraction evaluated separately from audio-to-event | Not measured | The script supports both paths; neither ran |
| p95 stop-to-review ≤ 15 s on a documented network, stage timings reported | Not measured | Needs devices, providers, and a network |
| Kill the worker after transcription, after extraction before draft commit, after job commit; one valid draft, no duplicate events | Verified with fakes | `worker-recovery.test.ts`: the transcription fake is called once across attempts; version predicates make the second write a no-op |
| Timeout, 429, 5xx, exhausted retries; manual entry still works; no false confirmation | Verified with fakes | `worker-recovery.test.ts`, `capture-confirmation.test.ts` |
| Checkpoints contain no plaintext transcript; crypto failure cannot publish a plaintext fallback | Verified | `pii-storage.test.ts` dumps `jobs.checkpoint` and `jobs.payload`; crypto failure is terminal |
| Kill and reopen the app before, during, and after upload without duplicate effects | Not verified on device | The outbox stage machine is implemented and unit-tested; the device checklist below covers it |
| Cost ≤ US$0.02 per typical recording | Not measured | Provenance records tokens; the script computes cost at list price once run |
| Voice discoverability, editing, and permission-denied flows | Not verified on device | Implemented per experience design section 3 |

## Material limitations and follow-ups

- No provider was ever called. Adapters are typed against the installed SDKs (Anthropic 0.124,
  Deepgram 5.10, Supabase 2.115) but unexecuted. The first live run of `pnpm eval:extraction`
  with keys is the next required step, and it may change the prompt.
- Audio bytes stay in `storage_reserved_bytes` until cleanup because no validation job settles
  them this milestone; milestone 4 adds media validation and settlement.
- Cleanup runs per workspace per day, seeded by the first upload. A cross-workspace sweep needs
  the milestone 5 maintenance capability.
- `dst_ambiguous` is surfaced as `date_unknown` in the transport ambiguity set.
- Reconnect detection is foreground plus a 30-second interval while rows are pending; NetInfo is
  not installed.
- The Maestro voice flow cannot speak the sentence; the first run needs a human or injected audio.

## Device checklist for the maintainer

Requires a dev client build (the expo-audio plugin adds the microphone permission string), a
running API with storage env, a running worker with Deepgram and Anthropic keys, and a
provisioned private bucket (`pnpm storage:provision`).

1. Discover: as a contributor, find Record update within five seconds; as a reader, see it
   disabled with a stated reason.
2. Permission: deny the microphone; confirm Type instead and Open settings remain; grant and
   record.
3. Kill before upload in airplane mode; reopen; Review pending update shows saved on this phone;
   restore network; exactly one capture exists server-side.
4. Kill during upload on a throttled network; reopen; one asset server-side.
5. Kill after upload before completion; reopen; one job, one draft.
6. Say "Fed 60 ml at two, then a wet diaper"; correct 60 to 90; answer Which day and AM or PM
   without returning to the recorder; remove and restore a card; Save 2 updates.
7. Force a provider failure; confirm plain-words error, Try again, and Enter manually.
8. Take a call mid-recording; the partial file is kept and reviewable.
9. Sign out with an unsent recording; confirm the notice, the deletion, and that a second account
   uploads nothing.
