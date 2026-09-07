# Handoff discovery pilot plan

Status: **planned, not run.** No pilot has taken place, no participant has been recruited, and no
number in [pilot results](pilot-results.md) has been collected. This document is the protocol to
follow if and when the milestone 5 engineering gate passes.

The purpose is discovery, not validation. Two to three small providers and roughly six to ten
caregivers over seven days cannot establish product-market fit. The targets in
[the roadmap](implementation-roadmap.md#product-acceptance-metrics) are **learning thresholds**: a
number that misses one is a reason to ask why, not evidence of failure, and a number that clears one
is not evidence of success.

## 1. Entry conditions

Do not recruit until all of these hold. Each is a milestone 5 engineering gate item.

- [ ] Full parent and daycare flows pass on iOS and Android, including a real physical-device
      recording and upload on each platform.
- [ ] Logout and account switching with pending local files leaves nothing of the first account on
      the phone and uploads nothing under the second (`tests/e2e/account-switch.yaml`).
- [ ] Child and workspace purge reaches a terminal state with no live objects or references left,
      verified by `pnpm tsx scripts/verify-purge.ts`.
- [ ] A disposable backup restores, and tenant isolation plus a known event/revision relationship
      survive it (`pnpm tsx scripts/verify-encrypted-restore.ts`).
- [ ] Raw transcripts, child names, signed URLs, and secrets are absent from logs and metrics
      samples.
- [ ] Production prompt and model ids are pinned and the extraction evaluation output for the exact
      build is archived.
- [ ] The runbook covers deployment, secrets, migrations, worker restarts, failed-job recovery,
      spend, cleanup, backup/restore, and rollback.
- [ ] Each provider's actual data handling and backup retention has been read, and the retention
      periods are written into the consent sheet below. Deleting local data is not a promise of
      provider-side erasure.

## 2. Recruitment

Recruit two to three small providers (one location each) and the families already attached to them,
targeting six to ten caregivers in total, subject to their willingness to participate. A provider
who declines is a finding, not an obstacle to route around.

Say plainly at recruitment:

- This is a seven-day prototype trial, not a product they are buying or committing to.
- Recordings go to a transcription company and the resulting words go to an AI company. Name both
  providers and their retention periods.
- They can stop at any point, and their data will be deleted on request within the documented
  window.
- Nothing they log here replaces their existing legal or licensing record-keeping. Handoff is an
  addition to their current routine for one week, not a replacement for it.

Exclude anyone who cannot give informed consent for the children in their care, and any setting
where the existing handoff routine is legally prescribed in a way this trial would disrupt.

## 3. Baseline first

**Measure the current routine before installing anything.** Without a baseline, a faster
acknowledgement time means nothing.

For each participating provider, spend one shift observing and recording:

| Baseline item | How it is captured |
| --- | --- |
| What the current handoff is | Written description: paper sheet, verbal at pickup, message thread, existing app |
| Time from starting the handoff to "I know what I need" | Stopwatch, five observed transitions per site, recorded per participant |
| What is written down versus said aloud | Tally of facts by kind (feed, sleep, diaper, milestone, note) |
| What gets missed | Ask the receiving caregiver, after each observed transition, what they still did not know |
| Perceived effort | One question, same wording each time: "How much work was that handoff, 1 to 5?" |
| Existing tooling cost | What they already pay for, if anything |

Record the baseline per participant, not per site: the comparison in the transition-effort metric is
against *each participant's* existing method.

## 4. What is observed versus what is instrumented

The roadmap warns against instrumenting every tap as a substitute for watching a handoff. This
pilot deliberately keeps most of its evidence qualitative.

| Measured by the database (`pnpm measure:pilot`) | Observed by a person |
| --- | --- |
| Activation: accepted invitations that reach a first acknowledged handoff within 24 hours | Whether the invitation flow made sense without help |
| Brief `created_at` to `acknowledged_at`, median | Time from opening a brief to "I know what I need", stopwatch, against that participant's baseline |
| Continued use: acknowledged handoffs on three or more separate days | Why someone stopped |
| Voice drafts whose draft version advanced before confirmation (a proxy, see below) | Which field was actually wrong, and whether it mattered |
| Provider token and audio-second usage | — |
| — | Whether important information was missing from a brief |
| — | Whether logging felt burdensome, and to whom |
| — | Whether a provider asks to keep using it or to pay |

Three metrics have no instrumentation at all and will be reported as such: useful-handoff ratings,
daycare staff effort in active seconds, and commercial signal. Do not add tracking categories to
manufacture them; collect them by asking.

**The correction-rate number is a proxy.** `scripts/measure-pilot.ts` counts voice captures whose
stored draft version advanced past the worker's first draft before confirmation. That detects "the
reviewer changed something", not "the reviewer corrected an amount, unit, date, or action". The
field-level breakdown the roadmap asks for requires watching reviews or storing per-field edit
flags, and neither exists yet. Report the proxy with that sentence attached, every time.

The in-app Diagnostics counters (`packages/mobile/src/observability/metrics.ts`) are opt-in,
in-memory, and never sent anywhere. They exist so an observer sitting with a participant can see
that an upload happened; they are not a data source for any metric in the results table.

## 5. Agent and developer access

Development agents and developers get **synthetic data only**.

- The pilot database is separate from any production database, with separate credentials.
- Seed it with `pnpm seed:pilot -- --owner user_… --staff user_… --guardian user_… --daycare-org
  org_… --household-org org_… --household-org org_…`. It creates a "Pilot Daycare" workspace, two
  households, six children named "Pilot Child A" through "Pilot Child F", and a week of synthetic
  confirmed care. It refuses to run with `NODE_ENV=production` and prints ids only.
- Nobody inspects a real participant's records to debug. Reproduce on synthetic data, or ask the
  participant to describe what they saw.
- Consent sheets state explicitly that developers do not read the content of their entries, and that
  support requests are answered from ids and error codes.
- Real recordings, transcripts, photographs, and names never enter Git, an issue tracker, a model
  prompt outside the product's own extraction call, or an agent transcript.

## 6. Running the week

| Day | Activity |
| --- | --- |
| −7 to −1 | Baseline observation at each site; consent signed; Clerk organizations created |
| 0 | Install builds (`eas build --profile preview`), invite caregivers, watch the first invitation acceptance without coaching |
| 1–7 | Normal use. One check-in call per site on day 3. No feature changes mid-pilot |
| 3 | Mid-pilot check: any stalled queue, any exceeded spend cap, any failed uploads |
| 7 | Close: final observation of five transitions per site, exit interview |
| 8 | `pnpm measure:pilot -- --since <day 0>`; fill in [pilot results](pilot-results.md) |
| 9 | Show each provider their own results and ask the commercial-signal question |
| ≤14 | Delete every participant workspace through the app's own deletion path; verify with the purge script |

Freeze the build for the week. A change mid-pilot makes the seven days incomparable to each other.

## 7. Stop rules

Stop the pilot immediately, notify participants, and do not restart until the cause is fixed and
re-tested, if any of these occur:

- Any caregiver sees another child's or another workspace's data.
- A recording, transcript, photo, or name appears in a log, a metrics sample, or an error response.
- A deletion request cannot be completed, or a purge leaves live objects behind.
- The worker queue stalls for more than an hour without recovery, or the provider spend cap is
  exceeded.
- A participant reports that Handoff caused a real care mistake, or that they relied on it instead
  of their required record-keeping.
- Any participant withdraws consent; stop for that participant and delete their workspace.

Pause and reconsider, without necessarily stopping, if two or more participants say the logging is
more work than their current routine, or if a provider asks to leave early.

## 8. Interpreting the result

- If participants prefer their existing method, the next iteration reduces transition and logging
  effort, or narrows the audience. It does not add attendance, rooms, billing, or integrations.
- Faster acknowledgement is not automatically better: ask whether important information was missing.
  A brief that is quick because nobody read it is a failure that looks like a success.
- Two concrete follow-up commitments would be a signal worth pursuing. Willingness to pay remains a
  hypothesis either way; a verbal "we'd pay for this" is not a commitment.
- Update the blueprint from what was observed before expanding scope.

## 9. Build and distribution notes

Both apps carry an `eas.json` with `development`, `preview`, and `production` profiles.

- `development` builds a dev client for internal distribution. `expo-dev-client` is already a
  dependency of both apps.
- `preview` is the internal-distribution build to install on participants' devices.
- No profile contains a secret. `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` are
  referenced by EAS environment-variable name only; set their values in the EAS project, not in the
  repository. Every server credential stays on the API and worker.
- `cli.version` is pinned to the EAS CLI major that was current when these files were written
  (23.x). Confirm with `npx eas-cli --version` before the first build and update both files
  together if the major has moved.
