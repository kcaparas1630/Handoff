# Milestone 5 report: pilot hardening, operational checks, and market test

Completed September 6, 2026, as engineering work. The product acceptance metrics in the
[roadmap](implementation-roadmap.md) require a real pilot with real providers and devices; none
has run. This report separates what is built and verified locally from what only a pilot can
establish.

## Engineering behavior implemented

- Structured JSON logging with an allowlist of field names, so a transcript, name, or URL cannot
  be logged by accident. In-process metrics for requests, jobs, queue age, provider calls,
  tokens, audio seconds, storage bytes, quota refusals, and a spend estimate, dumped
  periodically and readable at an operator-only endpoint guarded by a shared token.
- Quotas checked before any provider work: captures per user per day, audio seconds per workspace
  per day, and an extraction budget per workspace per day backed by a `provider_usage` table.
  Manual entry is unaffected by a voice quota.
- Child and workspace deletion: the request marks data inaccessible at once, closes sessions,
  cancels pending work, and enqueues a resumable purge that deletes objects, moves quota exactly
  once, redacts brief snapshots, removes rows on the dispatcher credential, and leaves an
  encrypted tombstone. Workspace deletion also removes the Clerk organization after commit and
  demotes the workspace keys, with retirement after a retention window.
- Account deletion via webhook anonymizes the profile, revokes memberships, and ends sessions.
- Data key rotation and KEK rewrap: a successor key goes active in one transaction; a resumable
  job re-encrypts every protected table with an optimistic predicate so a concurrent correction
  wins and no care revision is created; retirement requires zero references.
- Privacy settings: a plain-language processing notice that gates voice and typed capture until
  accepted, typed-confirmation deletion of a child or workspace, local file counts and cleanup,
  diagnostics from an opt-in client metric buffer with no free-text fields, and sign-out with an
  unsent-files notice.
- EAS build profiles for both apps, a package-boundary check in CI, integration and build CI
  jobs, pilot seed and measurement scripts, and the pilot plan and results template.

## Paths changed

Server (`observability/`, `services/{quotas,deletion,self,key-rotation}.ts`,
`jobs/{purge-child,purge-workspace,rotate-data-keys}.ts`, `lib/provider-rates.ts`), database
(migrations `0007`/`0008`, `provider_usage`, purge repository), API routes (`DELETE children`,
`DELETE workspaces`, `PATCH me`, `GET internal/metrics`), worker, features (`settings/`),
mobile (`observability/`), `apps/*/eas.json`, `.github/workflows/ci.yml`,
`scripts/{check-package-boundaries.mjs,seed-pilot.ts,measure-pilot.ts,verify-encrypted-restore.ts,verify-purge.ts}`,
`docs/{runbook,pilot-plan,pilot-results}.md`, tests. Commits `883c71d` through the server
hardening commit on `main`.

## Commands run and results

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm check:boundaries` | Clean |
| `pnpm test:unit` | 350 passed |
| `DATABASE_URL=… pnpm test:integration` | 236 passed, 1 skipped (opt-in performance) |
| `pnpm build:api` | 29 API routes exported |
| Native exports | Both apps bundle |

## Engineering acceptance gate status

| Gate item | Status | Evidence or gap |
| --- | --- | --- |
| Full parent and daycare flows on iOS and Android with a physical-device recording | Not run | `tests/e2e/full-parent-flow.yaml`, `full-daycare-flow.yaml` written, unexecuted |
| Logout and account switching with pending local files; revoked access fails within the window; issued URLs follow their TTL | Partial | Revocation and TTL verified in `revocation-purge.test.ts` and `media-access.test.ts`; the device switch is in `account-switch.yaml`, unexecuted |
| Purge reaches a terminal state with zero live objects or references; crash and retry cause no double decrement or resurrection | Verified | `revocation-purge.test.ts`; `scripts/verify-purge.ts` reports counts |
| Restore a backup and verify tenant isolation and a known relationship | Partial | `scripts/verify-encrypted-restore.ts` exists; no backup was taken or restored |
| KEK and DEK rotation, lookup-key transition, encrypted backup recovery, resumable re-encryption | Partial | Rotation, rewrap with two KEKs, resumption, and concurrent-edit safety verified in `key-rotation.test.ts`; the invitation lookup-key transition is a documented procedure only |
| Detect a stalled queue and exceeded budget from metrics; no transcript, name, URL, or secret in logs | Verified locally | Queue-age gauge and spend estimate exist with runbook thresholds; the logger allowlist test drops a transcript field |
| Pin production prompt and model IDs; archive evaluation output with the build | Partial | Prompt version and model ID are recorded on each capture; no evaluation has run |

## Product acceptance metrics

None measured. No pilot has run, no provider has been called, and no device has executed a
flow. `docs/pilot-results.md` is a blank template; `scripts/measure-pilot.ts` computes what the
database can support and labels the rest as not instrumented or not collected.

## Material limitations and follow-ups

- Every provider integration (Clerk hosted flows, Deepgram, Anthropic, Supabase Storage, KMS) is
  typed against its SDK and exercised only through fakes. The first real run of onboarding,
  `pnpm eval:extraction`, and an upload is the next step and may surface integration defects.
- The Deepgram rate is a named placeholder; spend figures are illustrations until a contracted
  rate is entered.
- Idempotency responses survive a child purge until their retry window expires; a workspace purge
  removes them.
- Metrics are per process; a multi-instance deployment needs aggregation.
- The EAS CLI version pin should be confirmed against the installed CLI before the first build.

## Operator checklist before a pilot

1. Provision Clerk (custom guardian role key), Supabase (private bucket via `pnpm
   storage:provision`), KMS, Deepgram, and Anthropic; fill `.env` from `.env.example`.
2. Run migrations, start the API and worker, and run `pnpm eval:extraction` with keys; record
   the per-field results in `docs/extraction-results/`.
3. Build both apps with `eas build --profile development` and run every `tests/e2e` flow on iOS
   and Android, including a physical-device recording.
4. Take a database backup, restore it into an isolated database, and run
   `scripts/verify-encrypted-restore.ts`.
5. Delete a seeded child and run `scripts/verify-purge.ts`.
6. Seed the pilot with `pnpm seed:pilot` and follow `docs/pilot-plan.md`.
