# Handoff: five-milestone implementation roadmap

Each milestone produces a usable, independently reviewable increment. Complete its acceptance gate before proceeding. All numerical thresholds below are **proposed targets**, not measured performance or evidence of market fit.

The weekend's priority is a working two-person loop. Milestones 1–3 establish it; milestone 4 adds the requested attachments; milestone 5 qualifies the prototype for a real pilot. Do not equate a weekend demo with completion of the real-user rollout gate.

## Roadmap at a glance

| Milestone | User-visible outcome | Primary measurable gate |
| --- | --- | --- |
| 1. Identity and shared foundation | Owner creates a child; invited person signs in and sees only granted children | All new/existing-user invite paths pass; zero access leaks across test tenants/children |
| 2. Manual journal and handoff | Two caregivers log facts and receive acknowledged briefs | Zero duplicate effects across 100 retries; 100 concurrent care starts produce one session per user/child |
| 3. Voice to reviewed events | Recording becomes editable structured event cards | >=95% correct explicit critical fields on evaluation fixtures; 100% invalid output blocked; p95 stop-to-review <=15 seconds on defined test network |
| 4. Optional media and recovery | Photos and short videos appear with confirmed updates | No unready/private asset exposure; successful recovery for every enumerated interrupted-upload case |
| 5. Pilot hardening and product test | Installable two-app pilot with deletion, observability, and evidence | All critical end-to-end flows pass; pilot measures transition speed, continued use, and cost |

## Shared execution conventions

- Follow root `AGENTS.md` for naming, comments, `types/` and `lib/` placement, and agent security. Follow `docs/experience-design.md` for the mobile experience; a functional generic checklist does not pass the visual/interaction brief.
- Follow `docs/pii-encryption.md` from the first persistence milestone. Encryption is not postponed to pilot hardening; migrations create ciphertext columns directly. Plaintext DTOs remain server-memory/API types, not database columns.
- Root package manager: pnpm workspaces. Use one lockfile and one version of React/React Native. Build apps in separate commands; neither may depend on another app.
- Client packages: `@handoff/ui`, `@handoff/features`, `@handoff/mobile`, `@handoff/api-client`, `@handoff/contracts`, and pure `@handoff/domain` where needed.
- Server packages: `@handoff/db` and `@handoff/server`. No transitive client import of either package.
- Package entrypoints export intentionally; avoid exporting an entire server package through a shared barrel.
- Root commands to provide: `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `eval:extraction`, `db:generate`, `db:migrate`, `dev:parents`, `dev:daycare`, `dev:api`, `dev:worker`, and per-app production builds. Commands become available with their milestone, not as fake passing placeholders.
- Use Vitest for pure/integration TypeScript tests and Maestro for native acceptance flows. Real concurrency and SQL constraint tests run against disposable Postgres/Supabase data, not only mocks. Hosted Clerk/provider checks use an isolated test environment.
- Fixtures must be synthetic or explicitly consented, with expected outcomes authored independently of the extractor. Do not put children's actual recordings in Git.
- Drizzle-generated migration journal/snapshots and `pnpm-lock.yaml` are generated outputs. The named SQL files below describe migration boundaries; use corresponding generated names and record their mapping if Drizzle prefixes differ.

## Milestone 1 — Shared foundation, identity, child onboarding, invitations

**Demo:** open both app flavors; owner initializes a workspace and child; a new user accepts an invitation and sees only that child. A second existing user can join without creating another identity.

### Files to create

Root/configuration:

```text
package.json
pnpm-workspace.yaml
tsconfig.json
eslint.config.mjs
.gitignore
.env.example
.github/workflows/ci.yml
packages/config/package.json
packages/config/tsconfig.base.json
packages/config/nativewind-preset.ts
```

Create these package manifests/configuration entrypoints:

| Package | Exact initial files |
| --- | --- |
| Contracts | `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts` |
| Domain | `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts` |
| Database | `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts` |
| Server | `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/index.ts` |
| API client | `packages/api-client/package.json`, `packages/api-client/tsconfig.json`, `packages/api-client/src/index.ts` |
| Mobile | `packages/mobile/package.json`, `packages/mobile/tsconfig.json`, `packages/mobile/src/index.ts` |
| UI | `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts` |
| Features | `packages/features/package.json`, `packages/features/tsconfig.json`, `packages/features/src/index.ts` |

Application shells:

```text
apps/parents/package.json
apps/parents/tsconfig.json
apps/parents/app.config.ts
apps/parents/metro.config.js
apps/parents/babel.config.js
apps/parents/tailwind.config.ts
apps/parents/global.css
apps/parents/nativewind-env.d.ts
apps/parents/app/_layout.tsx
apps/parents/app/index.tsx
apps/parents/app/sign-in.tsx
apps/parents/app/onboarding.tsx
apps/parents/app/invitations.tsx
apps/parents/app/children/[childId]/index.tsx
apps/parents/src/flavor.ts
apps/daycare/package.json
apps/daycare/tsconfig.json
apps/daycare/app.config.ts
apps/daycare/metro.config.js
apps/daycare/babel.config.js
apps/daycare/tailwind.config.ts
apps/daycare/global.css
apps/daycare/nativewind-env.d.ts
apps/daycare/app/_layout.tsx
apps/daycare/app/index.tsx
apps/daycare/app/sign-in.tsx
apps/daycare/app/onboarding.tsx
apps/daycare/app/invitations.tsx
apps/daycare/app/children/[childId]/index.tsx
apps/daycare/src/flavor.ts
apps/api/package.json
apps/api/tsconfig.json
apps/api/app.config.ts
apps/api/metro.config.js
apps/api/server.ts
apps/api/src/app/_layout.tsx
apps/api/src/app/index.tsx
apps/api/src/app/accept-invitation.tsx
```

These NativeWind configuration paths assume the stable setup selected in the initial compatibility check. If that version uses a different integration, update this file manifest before coding so the next model follows one coherent configuration.

Shared foundation and identity:

```text
packages/contracts/src/schemas/api-envelope.ts
packages/contracts/src/schemas/identity.ts
packages/contracts/src/schemas/children.ts
packages/contracts/src/schemas/invitations.ts
packages/contracts/src/types/api-envelope.ts
packages/contracts/src/types/identity.ts
packages/contracts/src/types/children.ts
packages/contracts/src/types/invitations.ts
packages/domain/src/lib/permissions.ts
packages/db/drizzle.config.ts
packages/db/src/client.ts
packages/db/src/tenant-transaction.ts
packages/db/src/schema/identity.ts
packages/db/src/schema/children.ts
packages/db/src/schema/invitations.ts
packages/db/src/schema/infrastructure.ts
packages/db/src/schema/data-keys.ts
packages/db/src/repositories/data-keys.ts
packages/db/src/repositories/identity.ts
packages/db/src/repositories/children.ts
packages/db/src/repositories/invitations.ts
packages/db/migrations/0001_identity.sql
packages/db/migrations/0002_access.sql
packages/server/src/config/env.ts
packages/server/src/http/handler.ts
packages/server/src/http/errors.ts
packages/server/src/http/idempotency.ts
packages/server/src/auth/clerk.ts
packages/server/src/auth/authorize.ts
packages/server/src/types/encryption.ts
packages/server/src/security/encryption/aes-gcm.ts
packages/server/src/security/encryption/data-keys.ts
packages/server/src/security/encryption/kms-key-wrapper.ts
packages/server/src/security/encryption/development-key-wrapper.ts
packages/server/src/security/encryption/lib/encryption-context.ts
packages/server/src/security/encryption/lib/invitation-lookup.ts
packages/server/src/security/encryption/aes-gcm.test.ts
packages/server/src/services/bootstrap.ts
packages/server/src/services/workspaces.ts
packages/server/src/services/children.ts
packages/server/src/services/invitations.ts
packages/server/src/services/memberships.ts
packages/server/src/services/clerk-webhooks.ts
packages/api-client/src/http.ts
packages/api-client/src/query-keys.ts
packages/api-client/src/identity.ts
packages/api-client/src/children.ts
packages/mobile/src/providers.tsx
packages/mobile/src/auth/token-cache.ts
packages/mobile/src/state/context-store.ts
packages/ui/src/Button.tsx
packages/ui/src/Screen.tsx
packages/ui/src/ChildCard.tsx
packages/ui/src/StatusMessage.tsx
packages/ui/src/theme/tokens.ts
packages/ui/src/types/theme.ts
packages/features/src/auth/SignInScreen.tsx
packages/features/src/onboarding/OnboardingScreen.tsx
packages/features/src/children/ChildListScreen.tsx
packages/features/src/children/ChildProfileScreen.tsx
packages/features/src/invitations/InvitationsScreen.tsx
```

API entrypoints:

```text
apps/api/src/app/v1/health+api.ts
apps/api/src/app/v1/bootstrap+api.ts
apps/api/src/app/v1/workspaces/index+api.ts
apps/api/src/app/v1/workspaces/[workspaceId]/children+api.ts
apps/api/src/app/v1/workspaces/[workspaceId]/invitations+api.ts
apps/api/src/app/v1/workspaces/[workspaceId]/members/[userId]+api.ts
apps/api/src/app/v1/children/[childId]/index+api.ts
apps/api/src/app/v1/children/[childId]/caregivers+api.ts
apps/api/src/app/v1/invitations/[invitationId]+api.ts
apps/api/src/app/v1/webhooks/clerk+api.ts
tests/integration/identity-access.test.ts
tests/integration/invitations.test.ts
tests/integration/tenant-context.test.ts
tests/integration/pii-storage.test.ts
tests/integration/encrypted-invitations.test.ts
tests/e2e/onboarding-invitation.yaml
```

### Logic boundaries

Routes parse/validate, establish auth context, call one use case, and map errors. They contain no SQL. Repositories handle SQL and transaction boundaries; services compose authorization and provider operations. `permissions.ts` is pure and testable. Screens consume the typed API client and shared UI.

Create the scoped wrapped-key registry with the identity migration, in dependency order after user/workspace roots and before invitation lookup-key references. Encryption modules perform authenticated encryption and allowed key access; authorized services validate plaintext and pass ciphertext objects to repositories. Do not put encryption/decryption in a generic Drizzle mapper. Initial profiles, invitation emails, and retained idempotent payloads must already be encrypted.

Implement identity, memberships, child grants, invitation intents, and idempotency/inbox/audit infrastructure now. Create the jobs table in milestone 3 after its referenced capture tables exist. Signature-verified webhooks can reconcile synchronously with retryable inbox state. Invitation status and `/bootstrap` perform bounded reconciliation so the initial flow does not depend on a not-yet-running worker. Membership removal and invitation revocation persist reconciliation-needed state for these bounded retries; the worker later automates recovery.

Child deletion is disabled in the UI until the purge implementation in milestone 5; the eventual endpoint is reserved in the contract. Do not create a success response that deletes only the profile and leaves objects/history behind.

### Acceptance gate

- Both Expo apps boot and render a shared child card with distinct app configuration; lint, typecheck, and production API export pass.
- Run the exported Node API, authenticate with a real Clerk test token, perform a tenant-scoped Postgres write, and verify a request without tenant context fails.
- New account, existing account, revoked invite, expired invite, duplicate callback, delayed webhook, and wrong-recipient acceptance all behave as specified. Ten duplicate deliveries yield one membership/grant set.
- Test two workspaces, two children in one daycare, and at least owner/staff/guardian roles. All forbidden API reads/writes fail, and guardian cannot fetch another household's child or the daycare roster through Clerk's own APIs.
- At least 20 alternating concurrent pooled requests across two tenants show zero workspace-context leakage.
- Synthetic name/email/birthdate markers are absent from plaintext SQL dumps, inbox/idempotency rows, and logs; authorized reads render them correctly. Test ciphertext swapping, tampering, wrong scope, missing keys, duplicate key provisioning, and key-service failure. Development keys cannot be selected in a production configuration.
- Median account-ready-to-child-created time <=2 minutes in five observed onboarding runs, excluding email arrival/sign-up time; record invite delivery/acceptance separately.

## Milestone 2 — Manual journal, concurrent care, deterministic handoff

**Demo:** A manually logs a feed and milestone. A and B can both start care. B reviews the brief and acknowledges it. A edits the feed, and B sees the correction as a new update.

### Files to create

```text
packages/contracts/src/schemas/events.ts
packages/contracts/src/schemas/captures.ts
packages/contracts/src/schemas/care.ts
packages/contracts/src/schemas/handoffs.ts
packages/contracts/src/schemas/overview.ts
packages/contracts/src/types/events.ts
packages/contracts/src/types/captures.ts
packages/contracts/src/types/care.ts
packages/contracts/src/types/handoffs.ts
packages/contracts/src/types/overview.ts
packages/domain/src/lib/event-rules.ts
packages/domain/src/lib/resolve-event-time.ts
packages/domain/src/lib/brief-renderer.ts
packages/domain/src/lib/brief-renderer.test.ts
packages/domain/src/lib/resolve-event-time.test.ts
packages/db/src/schema/journal.ts
packages/db/src/schema/care.ts
packages/db/src/repositories/captures.ts
packages/db/src/repositories/events.ts
packages/db/src/repositories/care.ts
packages/db/src/repositories/handoffs.ts
packages/db/src/repositories/overview.ts
packages/db/migrations/0003_journal_and_care.sql
packages/server/src/services/captures.ts
packages/server/src/services/events.ts
packages/server/src/services/care.ts
packages/server/src/services/handoffs.ts
packages/server/src/services/overview.ts
packages/api-client/src/captures.ts
packages/api-client/src/events.ts
packages/api-client/src/care.ts
packages/api-client/src/handoffs.ts
packages/api-client/src/overview.ts
packages/ui/src/EventCard.tsx
packages/ui/src/HandoffCard.tsx
packages/ui/src/CareSnapshot.tsx
packages/ui/src/QuickCareActions.tsx
packages/ui/src/types/care-snapshot.ts
packages/ui/src/types/quick-care-actions.ts
packages/features/src/journal/CareDashboardScreen.tsx
packages/features/src/journal/QuickEntrySheet.tsx
packages/features/src/journal/JournalScreen.tsx
packages/features/src/journal/EventEditor.tsx
packages/features/src/handoff/HandoffScreen.tsx
packages/features/src/care/CareStatus.tsx
apps/parents/app/children/[childId]/handoff.tsx
apps/daycare/app/children/[childId]/handoff.tsx
apps/api/src/app/v1/captures/index+api.ts
apps/api/src/app/v1/captures/[captureId]/index+api.ts
apps/api/src/app/v1/captures/[captureId]/confirm+api.ts
apps/api/src/app/v1/children/[childId]/events+api.ts
apps/api/src/app/v1/children/[childId]/overview+api.ts
apps/api/src/app/v1/events/[eventId]+api.ts
apps/api/src/app/v1/children/[childId]/care+api.ts
apps/api/src/app/v1/children/[childId]/handoffs+api.ts
apps/api/src/app/v1/handoffs/[briefId]/index+api.ts
apps/api/src/app/v1/handoffs/[briefId]/acknowledge+api.ts
tests/integration/journal-transactions.test.ts
tests/integration/care-concurrency.test.ts
tests/integration/handoff-boundaries.test.ts
tests/integration/overview-access.test.ts
tests/e2e/manual-handoff.yaml
```

Modify both child index routes to compose the shared care dashboard and care controls, with full journal history accessible from the dashboard. Add new schema exports and migrations to the existing migrator. Keep media snapshot fields as empty arrays until milestone 4. Do not display a nonfunctional recording control before milestone 3; promote the real manual quick-entry action in this increment.

### Logic boundaries

Manual form → validated capture draft → confirmation service is the only create-event path. The event repository locks the child and atomically writes projections, revisions, and the idempotency result. Time rules and brief rendering are pure functions. Handoff service selects its snapshot from a repeatable-read view; acknowledgement and optional care start are one transaction. No AI dependency exists in this milestone.

### Acceptance gate

- Feed with/without amount, diaper with qualitative quantity, sleep interval, milestone quote, and a planned note render correctly from confirmed data.
- 100 concurrent retries of the same capture confirmation produce one event per selected candidate. Same key/different body returns 409.
- 100 concurrent start requests for A produce one active A session; B can independently have one. Ending A leaves B active.
- Tests cover: late upload after cutoff; correction of an older event; deletion after brief generation; pending draft; empty brief; first-visit window; stale acknowledgement; two devices acknowledging out of order; event write that rolls back after counter allocation.
- Every rendered fact has a source revision. No plan becomes a completed feed. Unknown amount/time stays unknown.
- Event quantities/details, revisions/source quotes, and stored briefs are encrypted, including repeated response bodies. Brief generation decrypts only permitted rows and re-encrypts its saved snapshot. DB checks cover visible metadata; domain validation covers encrypted amount/detail invariants. Run the PII storage tests against this expanded schema.
- The overview finds latest-known care beyond the first journal page and preserves uncertainty for newly reported unknown-time events. Its caller-specific unread count and child scope cannot leak across users/children; loading the dashboard does not acknowledge a handoff.
- API p95 journal read and template brief creation <=500 ms against 10,000 synthetic revisions for a child in the test environment, excluding network to the device. Capture query plans if the target fails; do not mask it by silently dropping updates.
- On-device brief usable within two seconds on the defined test network in 20 runs. Record server latency separately from device/network latency.
- Complete the quick-entry and handoff comprehension checks in `docs/experience-design.md`. Verify populated, empty, unknown-time, pending, error, large-text, and reader-only states; a checklist-style home does not satisfy the design requirement.

## Milestone 3 — Voice capture, durable processing, human review

**Demo:** speak “Fed 60 ml at 2 am, and first word Dada,” review two drafts, correct the date, and save. Close the app after upload; the worker completes and drafts appear on return.

### Files to create

```text
apps/worker/package.json
apps/worker/tsconfig.json
apps/worker/src/index.ts
packages/contracts/src/schemas/extraction.ts
packages/contracts/src/schemas/media.ts
packages/contracts/src/types/extraction.ts
packages/contracts/src/types/media.ts
packages/db/src/schema/media.ts
packages/db/src/repositories/media.ts
packages/db/src/repositories/jobs.ts
packages/db/migrations/0004_media_and_jobs.sql
packages/server/src/storage/object-storage.ts
packages/server/src/storage/supabase-storage.ts
packages/server/src/transcription/provider.ts
packages/server/src/transcription/deepgram.ts
packages/server/src/ai/anthropic.ts
packages/server/src/ai/extract-events.ts
packages/server/src/ai/prompts/extract-events-v1.ts
packages/server/src/jobs/runner.ts
packages/server/src/jobs/process-capture.ts
packages/server/src/jobs/reconcile-clerk.ts
packages/server/src/jobs/cleanup-audio.ts
packages/server/src/services/uploads.ts
packages/mobile/src/audio/recorder.ts
packages/mobile/src/outbox/database.ts
packages/mobile/src/outbox/schema.sql
packages/mobile/src/outbox/sync.ts
packages/mobile/src/state/recording-store.ts
packages/features/src/recording/RecordScreen.tsx
packages/features/src/recording/ReviewCaptureScreen.tsx
packages/ui/src/RecordButton.tsx
packages/ui/src/DraftEventCard.tsx
apps/parents/app/children/[childId]/record.tsx
apps/parents/app/captures/[captureId].tsx
apps/daycare/app/children/[childId]/record.tsx
apps/daycare/app/captures/[captureId].tsx
apps/api/src/app/v1/captures/[captureId]/complete+api.ts
apps/api/src/app/v1/captures/[captureId]/retry+api.ts
tests/fixtures/extraction-cases.jsonl
tests/fixtures/audio/manifest.json
tests/integration/worker-recovery.test.ts
tests/integration/capture-confirmation.test.ts
tests/integration/audio-upload.test.ts
tests/e2e/voice-handoff.yaml
scripts/evaluate-extraction.ts
docs/extraction-evaluation.md
```

Store each synthetic evaluation recording under the exact relative filename listed in `tests/fixtures/audio/manifest.json`, alongside expected transcript/facts and consent/source classification. The manifest is the auditable file list; do not manufacture benchmark results.

Modify capture service/routes to support audio and text, add worker environment configuration, and extend mobile providers for foreground outbox synchronization. Manual entry remains functional. Create the private storage bucket and restrictive limits through a documented reproducible provisioning script in `scripts/provision-storage.ts`.

### Logic boundaries

Recorder only controls device audio and persists local files. Outbox only manages durable upload attempts and canonical server acknowledgements. Storage adapter only signs/reads/deletes authorized object IDs supplied by use cases. Transcription adapter returns transcript/metadata. Anthropic adapter returns typed candidates, never database writes. Worker handles lease/checkpoints and commits draft state only if capture version/status and lease are still current. Confirmation service from milestone 2 remains the sole publication path.

Start with worker concurrency two and measured timeouts. A completed transcription checkpoint survives an extraction error. Manual drafts are not rerun through AI. No image/video interpretation is added.

### Acceptance gate

- At least 50 labeled transcript fixtures and 20 synthetic/consented audio clips cover all event types, silence/noise, negation, future plans, corrections, missing amounts, multiple events, midnight, AM/PM ambiguity, daylight-saving ambiguity, and another child's name.
- >=95% exact accuracy across explicitly spoken critical fields (event kind, amount, unit, explicit time components) on the labeled fixtures. Report per-field results and counts, not just a single aggregate.
- Zero invented quantities or completed-care actions from the negation/future fixtures. 100% malformed or semantically invalid candidate responses are blocked from publication. Date proposals requiring context remain reviewable and are not counted as ground-truth speech facts.
- The same fixtures evaluate transcript extraction separately from audio-to-event output so transcription failures are visible. Do not treat LLM self-reported confidence as an accuracy metric.
- Across at least 20 recordings <=30 seconds, target p95 stop-to-review <=15 seconds on a documented network (for example stable Wi-Fi with >=10 Mbps upload). Also report upload, queue, transcription, extraction, and total timings separately. This is a target to validate, not a provider SLA.
- Kill the worker after transcription, after extraction but before draft commit, and after job commit but before response. Reclaiming jobs leaves one valid draft and no duplicate confirmed events.
- Simulate timeout/429/5xx and exhausted retries. Manual entry still works; errors are recoverable; a capture is not falsely marked confirmed.
- Transcription/extraction checkpoints contain no plaintext transcript outside the encrypted capture. Worker decryption stays scoped to its authorized source, and a crypto/key failure cannot publish a plaintext fallback or a partial event.
- Kill/reopen the app before upload, during upload, and after complete response loss. All recoverable local captures can be resumed without duplicate effects.
- Estimated ASR + LLM variable cost per typical recording <=US$0.02 as an initial product budget; calculate from actual audio seconds/token usage and current contracted rates. Report exceptions, including billable retries.
- Complete the voice discoverability, editing, and permission-denied flows in `docs/experience-design.md` without making manual entry less accessible.

## Milestone 4 — Photos, short videos, private access, interrupted uploads

**Demo:** attach a photo and short video after a recording; an authorized recipient sees them from the brief. An attachment added after an earlier handoff appears in the next update.

### Files to create

```text
packages/server/src/services/media.ts
packages/server/src/jobs/validate-media.ts
packages/server/src/jobs/cleanup-uploads.ts
packages/server/src/media/inspect.ts
packages/server/src/media/normalize-image.ts
packages/mobile/src/media/picker.ts
packages/mobile/src/media/prepare-image.ts
packages/api-client/src/media.ts
packages/features/src/recording/AttachmentPicker.tsx
packages/features/src/journal/AttachmentViewer.tsx
packages/ui/src/AttachmentTile.tsx
apps/api/src/app/v1/captures/[captureId]/assets+api.ts
apps/api/src/app/v1/assets/[assetId]/complete+api.ts
apps/api/src/app/v1/assets/[assetId]/index+api.ts
tests/integration/media-access.test.ts
tests/integration/media-lifecycle.test.ts
tests/e2e/media-handoff.yaml
```

Modify existing capture review, event service, revision snapshot validator, worker dispatcher, outbox, and storage provisioning limits. Media validation may need a vetted server image library and video-container inspector; pick compatible stable versions and include their deployment requirements in `docs/runbook.md` when introduced.

### Logic boundaries

Client preprocessing improves upload size; server validation remains authoritative. Media completion enqueues validation; only validation publishes ready assets and event revisions. Gallery/signing code never exposes raw audio using ordinary image/video permissions. Storage cleanup is idempotent and releases quota exactly once.

### Acceptance gate

- Author/owner/linked-reader/wrong-child/wrong-tenant/revoked-member matrix passes for image and video signing. Other caregivers cannot sign an author's raw audio or unconfirmed source media.
- MIME spoof, excessive size/duration, path tampering, overwrite attempt, missing upload, unsupported codec, quota race, duplicate completion, expired token, and orphan object are handled explicitly.
- A rejected or unvalidated upload is never shown as ready. An object deleted by cleanup does not leave a working gallery reference.
- Photo metadata inspection shows no GPS fields in published images. Tests inspect server-normalized output, not just the client's declared result.
- A replayed publish job creates one attachment publication per affected event, not endless new revisions.
- Photo and video complete and play on representative iOS and Android devices. Target first image display <=2 seconds for a <=1 MB image on the documented test network; collect video playback/format failures separately.
- Content does not appear across account switches, and users can see which files remain device-local or awaiting validation.

## Milestone 5 — Pilot hardening, operational checks, and market test

**Demo:** install both app builds, run the whole handoff with two accounts, revoke a caregiver, delete a test child, and show that its records and objects are purged. Run a small pilot with recorded baseline comparisons.

### Files to create

```text
packages/server/src/observability/logger.ts
packages/server/src/observability/metrics.ts
packages/server/src/services/quotas.ts
packages/server/src/services/deletion.ts
packages/server/src/jobs/purge-child.ts
packages/server/src/jobs/purge-workspace.ts
packages/server/src/jobs/rotate-data-keys.ts
scripts/verify-encrypted-restore.ts
tests/integration/key-rotation.test.ts
packages/mobile/src/observability/metrics.ts
packages/features/src/settings/PrivacySettingsScreen.tsx
apps/parents/app/settings.tsx
apps/daycare/app/settings.tsx
apps/parents/eas.json
apps/daycare/eas.json
scripts/check-package-boundaries.mjs
scripts/seed-pilot.ts
scripts/measure-pilot.ts
scripts/verify-purge.ts
tests/integration/revocation-purge.test.ts
tests/integration/quotas.test.ts
tests/e2e/full-parent-flow.yaml
tests/e2e/full-daycare-flow.yaml
tests/e2e/account-switch.yaml
docs/runbook.md
docs/pilot-plan.md
docs/pilot-results.md
```

Modify CI to enforce dependency boundaries and relevant test commands. Wire deletion into the reserved child DELETE route and settings. Add workspace deletion to `apps/api/src/app/v1/workspaces/[workspaceId]/index+api.ts` for the contract's owner-only `DELETE /v1/workspaces/:workspaceId`. User auth-account deletion is handled through Clerk plus a verified webhook anonymization/revocation workflow in the existing membership service.

### Logic boundaries

Telemetry contains metrics and opaque IDs, not journal content. Quotas authorize resource creation before provider work. Purge marks data inaccessible first, cancels pending work, deletes objects, then removes/redacts captures/events/revisions/brief snapshots and identity relationships according to the chosen policy. It cannot race a worker into recreating deleted content: worker final writes require active source entities. Runbook owns deployment, secrets, migrations, worker restarts, failed-job recovery, spending, cleanup, backup/restore, and rollback.

### Engineering acceptance gate

- Full parent and daycare flows pass on iOS and Android; include a real physical-device recording/upload test on each platform before calling voice complete.
- Test logout/account switching with pending local files; revoked access fails on API requests within the documented verification window. Previously issued signed URLs follow their documented TTL, and new ones are denied.
- Child/workspace purge reaches a terminal state with zero remaining live objects/references from the test data, including brief snapshots. Crash/retry the purge and verify no double quota decrement or resurrected events.
- Restore a disposable backup and verify tenant isolation and a known event/revision relationship. Document any provider backup limitations and retention; do not claim physical backup erasure on immediate app deletion.
- Verify the encryption contract's KEK/DEK rotation, invitation lookup-key transition, encrypted backup recovery, and resumable re-encryption checks. Retain old keys while required records/backups depend on them; child deletion must not destroy a shared workspace key. Include key-service permissions and failures in the runbook.
- Detect a deliberately stalled queue and exceeded budget from metrics. Verify raw transcript, child name, signed URLs, and secrets are absent from logs and analytics samples.
- Pin production prompt/model IDs and archive extraction evaluation output with the build. Sensitive behavioral changes require rerunning the fixed evaluation corpus.

### Product acceptance metrics

Recruit 2–3 small providers and roughly 6–10 caregivers for a 7-day discovery pilot, subject to their ability to participate. First measure their current handoff routine. These are learning thresholds, not statistically reliable market validation:

| Metric | Definition | Initial target |
| --- | --- | --- |
| Activation | Invited caregivers who accept and complete a first acknowledged handoff within 24 hours / eligible invitations delivered | >=70% |
| Transition effort | Median time from opening brief to “I know what I need” compared with each participant's existing method | >=30% reduction; median <=30 seconds |
| Useful handoffs | Completed, user-rated useful handoffs / all rated handoffs | >=80%; collect missing-fact explanations |
| Critical correction rate | Voice drafts needing amount/unit/date/action correction / reviewed voice drafts | <=10%, with field-level breakdown |
| Continued use | Activated caregivers completing handoffs on >=3 separate pilot days / activated caregivers with >=3 care days | >=60% |
| Daycare staff effort | Active seconds recording/reviewing per confirmed event vs baseline method | Improvement without more mandatory logging |
| Variable cost | Transcription + AI + storage/egress attributable to pilot / completed handoffs | Report observed cost and cost at 10× usage |
| Commercial signal | Providers who request continued use or a paid follow-up after seeing their own results | At least two concrete follow-up commitments; willingness-to-pay remains a hypothesis |

Include denominator and missing-data counts in every metric. Ask whether important information was missing or logging felt burdensome; faster acknowledgement alone can mean people skipped reading. Do not instrument every tap as a substitute for observing the handoff.

If users prefer their existing method, the next iteration should reduce transition/logging effort or narrow the audience, not automatically add more tracking categories. Update the blueprint from evidence before expanding rooms, attendance, billing, or integrations.
