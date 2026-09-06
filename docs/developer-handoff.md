# Developer execution brief

You are implementing Handoff from an architecture contract.

Read the root [AGENTS.md](../AGENTS.md) first for coding conventions and agent security boundaries. [Architecture questions](architecture-questions.md) clarifies platform/language coverage and distinguishes proposed checklist work from the current milestones.

Read these files in order, including [experience design](experience-design.md) before implementing mobile screens:

1. [Architecture and data flows](architecture.md).
2. [Database and API contract](data-contract.md).
3. [Five-milestone roadmap](implementation-roadmap.md).
4. [PII encryption](pii-encryption.md), required before milestone 1 persistence is implemented.

The repository currently contains documentation only. Do not report a feature as implemented because its spec exists. Implement one milestone at a time; report its actual validation results, unfinished requirements, and any necessary contract changes.

## Preserve these decisions

- Two thin Expo/React Native/NativeWind app shells (`parents`, `daycare`) consume shared packages. Neither imports the other app.
- One Expo Router API on Node and one durable Node worker share TypeScript server services. Supabase Postgres is accessed through server-only Drizzle; private Supabase Storage holds media.
- Clerk owns identity and organization invitations. A local user projection, active workspace memberships, and explicit per-child grants determine application access. Configure Clerk guardian roster restrictions as well as Handoff API restrictions.
- Multiple people can care concurrently. There is one open session per child/user, not one exclusive owner of the child.
- A handoff consumes a recipient-specific snapshot only on explicit acknowledgement. Event revisions and a transactionally locked per-child sequence protect against late uploads, concurrent writes, and corrections.
- Speech-to-text is a separate provider. One Anthropic call formats the raw transcript and extracts editable candidates. Structured output validation does not establish truth.
- Only user-confirmed events enter the journal. Unknown values stay unknown; reported facts, negations, and future plans remain distinct. Every brief fact links to a source revision.
- Build manual entry and deterministic briefs before AI. Keep them usable when voice providers fail.
- Uploads and jobs are retryable, durable, and idempotent. External provider effects cannot share a Postgres transaction; use persisted state and reconciliation.
- Objects are private. Store provider/bucket/key, not signed URLs. Enforce upload budgets, file validation, retention, and deletion of both objects and rows.
- Covered Postgres values are encrypted by the server before persistence and decrypted only after authorization. Keep raw data keys/production wrapping keys out of the database and clients; follow the encryption contract for snapshots, invitation equality lookup, rotation, and failure behavior.

## Working method

Before application coding, select a stable compatible dependency set and prove the small deployment/auth/database spike in milestone 1. Record package/runtime versions; do not copy obsolete skill examples or choose prereleases just because an online example shows them.

Use the roadmap's exact file manifest as the starting point. Keep route handlers thin and business rules in their assigned packages. If a pinned tool version requires a file-path change, update the manifest and explain why. Do not create fake provider integrations, placeholder successful mutations, or tests that merely reproduce implementation outputs.

For each milestone, provide the user-visible behavior implemented, paths changed, commands actually run, test/evaluation results, and material limitations. Targets are not measured results. Do not silently remove an acceptance gate to declare success.

The complete roadmap is larger than a disposable weekend demo. Preserve the functional priority: invitation → child → manual event → acknowledged handoff → voice → media → pilot qualification. Avoid expanding scope with room management, billing, a chat agent, media inference, or microservices.

## Environment contract

Public mobile configuration:

```text
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
EXPO_PUBLIC_API_URL
```

Server/worker-only configuration:

```text
CLERK_SECRET_KEY
CLERK_WEBHOOK_SIGNING_SECRET
CLERK_GUARDIAN_ROLE_KEY
CLERK_AUTHORIZED_PARTIES
DATABASE_URL
DATABASE_MIGRATION_URL
DATABASE_JOB_DISPATCH_URL
SUPABASE_URL
SUPABASE_STORAGE_SECRET_KEY
SUPABASE_STORAGE_BUCKET
DEEPGRAM_API_KEY
TRANSCRIPTION_MODEL_ID
ANTHROPIC_API_KEY
ANTHROPIC_MODEL_ID
INVITATION_REDIRECT_URL
APP_LINK_PARENTS
APP_LINK_DAYCARE
PII_KEY_PROVIDER
PII_KMS_KEY_ID
AWS_REGION
PII_DEV_WRAPPING_KEY_B64
WORKER_CONCURRENCY
WORKER_LEASE_SECONDS
```

These are application-selected environment names. Map the Supabase storage secret to the supported server SDK credential for the provisioned project. Distinct database URLs represent restricted runtime, migration, and dispatcher capabilities. Validate required configuration at startup; do not include secret values in client bundles, example files, error responses, or logs.

`CLERK_AUTHORIZED_PARTIES` is the comma-separated allowlist of origins a session token may be presented from; leaving it unset skips that check and is only appropriate in local development. `WORKER_CONCURRENCY` and `WORKER_LEASE_SECONDS` bound how many jobs one worker claims at a time and how long a claim survives a crash; both have defaults, so the worker starts without them.

`PII_KEY_PROVIDER` selects managed KMS for production or the explicitly development-only wrapping adapter. `PII_KMS_KEY_ID` is a key reference, not key material. Prefer a scoped workload identity for AWS access. `PII_DEV_WRAPPING_KEY_B64` is only for local/synthetic tests and must be rejected in production; never commit its value.

## Completion definition

The product loop works with two distinct accounts: invite, onboard/access a child, record or type observations, review/confirm events, optionally attach media, review a source-linked brief, and acknowledge/start care. Concurrent care, duplicate submissions, late uploads, corrections, unauthorized child access, provider failures, and interrupted uploads behave according to the contract. A real-user pilot additionally requires milestone 5's operational and device checks.
