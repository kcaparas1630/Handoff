# Handoff operations runbook

What an operator has to get right for the deployed system to work, and what to check when it does
not. The service architecture is in [architecture.md](architecture.md), and configuration variables
are named (never valued) in `.env.example`. Nothing in this document contains a secret value, a
connection string, or a customer identifier, and nothing added to it should.

## Processes

| Process | Entry point | Needs |
| --- | --- | --- |
| API | `apps/api` (Expo Router API routes) | `DATABASE_URL`, Clerk, storage, PII key provider |
| Worker | `apps/worker` | everything the API needs, plus `DATABASE_JOB_DISPATCH_URL`, Deepgram, Anthropic, and the sharp native binary |
| Migrator | `pnpm db:migrate` | `DATABASE_MIGRATION_URL` only |

The API never claims jobs and the worker serves no HTTP traffic. They use different database
roles: `handoff_api` is tenant scoped and cannot take a job lease, and `handoff_dispatcher` reaches
the queue plus the tables a purge removes rows from. Deploying the worker with the API's connection
string silently disables the queue and the purge.

Neither runtime role can create or drop a table. Schema changes go through
`DATABASE_MIGRATION_URL`, which is a separate credential and is not configured on the API or the
worker.

## Deployment order

1. **Migrate first, deploy second.** Every migration in this repository is additive: new enum
   values, new columns, new tables, new grants. A running old build tolerates them, so the migrator
   can run before the new code is live and a rollback does not have to undo schema.
2. `DATABASE_MIGRATION_URL=... pnpm db:migrate`. Re-running it applies nothing.
3. Deploy the API, then the worker. The worker is the process that performs deletions and
   re-encryption, so bringing it up last means those only start once the schema is in place.
4. `node -e "require('sharp')"` on the worker host (see below), and one `GET /v1/health`
   against the API.

## Secrets

| Variable | Held by | Notes |
| --- | --- | --- |
| `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` | API, worker | Never in a mobile bundle |
| `DATABASE_URL`, `DATABASE_JOB_DISPATCH_URL` | API (first), worker (both) | Different roles, different capabilities |
| `DATABASE_MIGRATION_URL` | migrator only | Owns the schema; not present at runtime |
| `SUPABASE_STORAGE_SECRET_KEY` | API, worker | Signs upload and read URLs |
| `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` | worker only | The API makes no provider call |
| `PII_KMS_KEY_ID`, `AWS_REGION` | API, worker | A key reference, not key material |
| `PII_DEV_WRAPPING_KEY_B64` | local only | Rejected when `NODE_ENV=production` |
| `INTERNAL_METRICS_TOKEN` | API | Absent means `GET /v1/internal/metrics` answers 404 |

Rotating an application secret is a redeploy of both processes with the new value. Rotating the
`PII_*` key material is not: see "Key rotation" below.

## Native image processing (sharp)

The worker inspects and normalizes every uploaded photo with [sharp](https://sharp.pixelplumbing.com/),
which is a native module built on libvips. This is a deployment requirement, not a pure-JavaScript
dependency:

- sharp resolves a prebuilt binary for the exact platform, architecture, and libc of the machine
  it runs on, through optional dependencies such as `@img/sharp-linux-x64` and
  `@img/sharp-linuxmusl-x64`. A `node_modules` tree installed on one platform and copied to
  another will fail at `import sharp` with a missing-binary error.
- Install dependencies on the target platform, or build the worker image on it. Alpine images need
  the musl build; a Debian-based image needs the glibc one. Do not `npm install --no-optional`.
- The repository pins `node-linker=hoisted` in `.npmrc`, so the binary lands in the root
  `node_modules/@img/`. A deployment that prunes optional dependencies breaks the worker only,
  and only when a photo arrives, so verify it at deploy time rather than at first upload.
- Check with `node -e "require('sharp')"` on the worker host. It exits silently when the binary
  loaded and throws otherwise.
- The API process does not use sharp. If the platform makes the native build difficult, that
  constraint applies to the worker image alone.

Video is inspected by a small pure-TypeScript container parser
(`packages/server/src/media/lib/mp4-duration.ts`), so it has no native dependency.

## Storage bucket

Run `pnpm storage:provision` once per environment. It is idempotent: an existing bucket is
reported and left alone, so it never relaxes limits already in place.

| Setting | Value | Why |
| --- | --- | --- |
| Visibility | private | Every read goes through a fresh authorized signature (architecture §6) |
| `fileSizeLimit` | 20 MB | The largest product limit (video); above every other one and below the provider's free-plan maximum |
| `allowedMimeTypes` | the audio, image, and video allowlists from `packages/contracts/src/schemas/media-limits.ts` | The provider enforces the same constraint the API enforces before it signs |

The application limits are enforced server-side and are stricter than the bucket: audio 60 s /
10 MB, image 5 MB, video 15 s / 20 MB, and at most three attachments per capture. Changing a
product limit means changing `media-limits.ts` and re-running the provisioning script; the bucket
value is the outer bound, not the product rule.

Per-workspace storage budgets live in `workspaces.storage_budget_bytes`. There is no endpoint that
edits them; raising a pilot workspace's budget is a deliberate database change.

## What the worker runs

| Job kind | Trigger | Chains |
| --- | --- | --- |
| `process_capture` | audio upload completed, or a typed capture created | no |
| `validate_media` | attachment upload completed | no |
| `reconcile_clerk` | worker startup, and a failed Clerk call | no |
| `cleanup_audio` | first audio upload in a workspace | re-enqueues itself daily |
| `cleanup_uploads` | first attachment allocation in a workspace | re-enqueues itself daily |
| `purge_child` | `DELETE /v1/children/:childId` | no |
| `purge_workspace` | `DELETE /v1/workspaces/:workspaceId` | purges every child inline |
| `rotate_data_keys` | a workspace content-key rotation | no |

Both sweeps re-enqueue tomorrow's run before reporting success, so the chain survives a crash but
not a workspace with no traffic at all. A workspace whose sweeps have stopped starts again on its
next upload. To restart one by hand, enqueue a row with the dedupe key
`cleanup_uploads:<workspaceId>:<YYYY-MM-DD>`.

`cleanup_uploads` also reconciles the bucket against the database: it lists up to 100 objects
under the workspace's own prefix and deletes any whose asset id has no row. It is bounded per run
on purpose, so a large backlog drains over several days rather than in one long transaction.

## Observability

There is no metrics backend in the pilot. Each process writes one JSON line per
`METRICS_FLUSH_SECONDS` (default 60) and then starts a new window:

```text
{"time":"…","level":"info","service":"worker","event":"metrics_snapshot","snapshot":{…}}
```

`GET /v1/internal/metrics` returns the same shape for the API process. It is protected by
`INTERNAL_METRICS_TOKEN` in an `X-Internal-Token` header, compared in constant time. With no token
configured the route answers 404: an endpoint nobody enabled should not announce itself.

Every log line goes through an allowlist of field names
(`packages/server/src/observability/logger.ts`). A field nobody approved is dropped and only a
`dropped_fields` count survives, so a transcript, a child's name, or a signed URL cannot reach a log
through a call site that was not thought through. Metric label values are opaque ids and closed
codes for the same reason.

| Series | Labels | Read it for |
| --- | --- | --- |
| `api_requests`, `api_request_duration_ms` | operation, status | Error rate and latency per operation |
| `jobs`, `job_duration_ms` | jobKind, status | Throughput and failures per job kind |
| `queue_oldest_age_seconds` | — | Age of the oldest job at the last claim, per window |
| `provider_tokens_in`, `provider_tokens_out`, `provider_audio_seconds` | workspaceId | What was actually spent |
| `provider_spend_estimate_usd` | — | Those counters priced with `lib/provider-rates.ts` |
| `quota_refusals` | status | Which ceiling caregivers are meeting |

### Thresholds

Starting points for a pilot, not tuned alerts.

| Reading | Investigate at | Means |
| --- | --- | --- |
| `queue_oldest_age_seconds` | above 300 | The worker is down, wedged, or has no dispatch credential. A stalled queue shows here before it shows in the app |
| `jobs` with `status="failed"` | any sustained rate | Read `jobs.last_error_code`; a repeated `unknown` on `validate_media` is usually the missing sharp binary |
| `provider_spend_estimate_usd` | above half the day's total budget by midday | Spend is running ahead of the per-workspace caps; `quota_refusals` shows which workspace is driving it |
| `quota_refusals` with `status="extraction_budget"` | any | A workspace spent its day's budget. Manual entry still works; raising the cap is a deliberate configuration change |
| `api_request_duration_ms` maximum | above 2000 ms | Usually a slow provider call inside a request that should not have one |

To detect a deliberately stalled queue: stop the worker, create one typed capture, and watch
`queue_oldest_age_seconds` climb past the threshold on the next snapshot line. To detect an exceeded
budget: set `QUOTA_EXTRACTION_USD_PER_WORKSPACE_PER_DAY` low in a test environment and confirm the
capture fails with `budget_exceeded` while manual entry keeps working.

## Spending caps and quotas

All three ceilings are per UTC day and are checked before any storage or provider work.

| Setting | Default | Enforced in | Refusal |
| --- | --- | --- | --- |
| `QUOTA_CAPTURES_PER_USER_PER_DAY` | 200 | `createCapture`, per author per workspace | 422 `rate_limited`, retryable |
| `QUOTA_AUDIO_SECONDS_PER_WORKSPACE_PER_DAY` | 3600 | `createCapture`, before an upload is signed | 422 `rate_limited`, retryable |
| `QUOTA_EXTRACTION_USD_PER_WORKSPACE_PER_DAY` | 5 | `process_capture`, before the model call | capture `failed` with `budget_exceeded` |

Spend is estimated from `handoff.provider_usage`, a numbers-only table keyed by workspace and UTC
day, priced with `packages/server/src/lib/provider-rates.ts`. The Deepgram rate there is a
placeholder: every transcription cost derived from it is an illustration until it is replaced with a
contracted rate. The same constants drive `pnpm eval:extraction`, so a budget and a cost report
cannot disagree.

Manual entry and typed notes are never refused by the spend cap, because they call no provider. That
is deliberate: a workspace that has spent its budget can still record care.

## Failed-job recovery

1. Find the row: `select id, kind, status, attempts, last_error_code, available_at from
   handoff.jobs where status = 'failed' order by updated_at desc limit 20;` on the dispatcher or
   migration credential. `last_error_code` is a closed code and never a provider message.
2. A caregiver-visible failed capture is retried from the app (`POST /captures/:captureId/retry`),
   which resets the attempt budget and keeps successful checkpoints, so transcription is not paid
   for twice.
3. A maintenance job (`cleanup_*`, `purge_*`, `rotate_data_keys`) has no user-facing retry. Requeue
   it by hand: set `status = 'queued'`, `attempts = 0`, `available_at = now()`, and
   `lease_token = null`. Every one of them is idempotent, so re-running a partially completed job is
   safe.
4. A workspace whose daily sweep chain broke (no traffic for a day) starts again on its next upload,
   or by inserting a row with the dedupe key `cleanup_uploads:<workspaceId>:<YYYY-MM-DD>`.
5. A crashed worker's leases expire on their own: the runner reclaims anything whose
   `lease_expires_at` has passed, so a restart needs no manual cleanup.

Restarting the worker is safe at any point. In-flight handlers finish before the process exits on
SIGTERM, and a handler killed mid-write loses its lease, so its writes stop matching and the next
attempt resumes from the last checkpoint.

## Deletion and purge

`DELETE /v1/children/:childId` and `DELETE /v1/workspaces/:workspaceId` are owner-only and return
202. They make the records unreachable in the same transaction that queues the purge; the job is
what removes objects and rows. The API credential holds no `DELETE` on any table, so nothing a
mobile request can do removes a row directly.

Order, and what survives:

1. Mark inaccessible. `authorizeChild` accepts only an `active` child, so the child is a 404 for
   every caller at once, including a worker re-authorizing a job it had already claimed.
2. Cancel queued and leased work for the child. The purge kinds are excluded from cancellation.
3. Delete every stored object, releasing or settling its quota exactly once through the asset's own
   `deleting` to `deleted` transition.
4. Redact brief snapshots: the row stays as the record that a recipient acknowledged a handoff, its
   `snapshot_ciphertext` becomes an encrypted empty snapshot, and its status becomes `redacted`.
5. Delete revisions, events, media rows, captures, care sessions, cursors, and child grants.
6. Leave the child row as a `deleted` tombstone with an encrypted empty profile, because the
   retained redacted briefs and the audit log still point at it.

A workspace purge runs that sequence for every child, then removes the briefs, invitations, retained
idempotency responses, and memberships, and demotes the workspace's scope keys.

Verify it:

```text
DATABASE_URL=... SUPABASE_URL=... SUPABASE_STORAGE_SECRET_KEY=... SUPABASE_STORAGE_BUCKET=...
pnpm verify:purge --workspace <uuid> --child <uuid>
```

It prints a count per table plus the number of objects under the child's prefix, and exits 1 if any
live reference remains. A completed purge prints zeroes everywhere except `redactedBriefs`. Crash and
retry the purge job, then run it again: the counts must not change and the workspace's storage
counters must not move a second time.

User account deletion is different. Clerk owns it; the verified `user.deleted` webhook marks the
local user `deleted`, replaces their display name with an encrypted empty profile, revokes every
membership, and closes their care sessions. Records they authored stay, attributed to a former
caregiver. Their workspaces are not deleted by that event.

## Key rotation, retention, and recovery

**DEK rotation.** `rotateWorkspaceContentKey` inserts a successor content key as `active` and marks
the previous one `decrypt_only` in one transaction, then queues `rotate_data_keys`. New writes use
the successor immediately; existing rows still read. The job re-encrypts table by table in bounded
batches, and each write carries the key id and nonce it read, so a caregiver's correction in the
meantime wins and no journal revision is created. It is resumable: a converted row stops matching the
old key, so a restarted job re-reads only what it has not done.

**Retirement.** A key is retired only when no envelope in any covered table still names it. A retired
key cannot be unwrapped at all, so this is the one irreversible step. Retiring a key that a retained
encrypted backup still depends on makes that backup unreadable; check the backup retention window
before retiring anything.

**Workspace key retention.** A workspace purge demotes the scope keys to `decrypt_only` at once and
retires them only after `WORKSPACE_KEY_RETENTION_DAYS` (default 30) have passed since
`workspaces.deleted_at`. Nothing re-runs the purge automatically after that window: the retirement
step is schedule-only, and an operator triggers it deliberately once backups no longer need the key.
Deleting one child never touches a workspace key: the key is shared, and a shared key gives no
individual child cryptographic erasure from historical backups.

**KEK rewrap.** `rewrapDataKeys` unwraps every stored data key with the wrapper that can still read
it and re-wraps it with the current one. No stored ciphertext changes, which is the point of envelope
encryption. Run it after introducing a new KMS key id, with the previous wrapper still available; the
integration test proves records written under one development key still read after a rewrap under a
second one.

**Invitation lookup keys are not rotated by any of this.** The lookup value is a workspace-keyed HMAC
used as an equality index, so changing it means recomputing every stored hash while both versions
have to match. That is a serialized procedure with its own duplicate-blocking rules: freeze new
invitations for the workspace, recompute and store the new hashes, switch reads, then remove the old
ones. It is not a background job.

## KMS permissions and failures

The runtime roles need exactly two KMS actions on the configured key: encrypt (wrap) and decrypt
(unwrap). They must not hold key deletion, key disabling, or policy editing. Prefer a scoped workload
identity over a long-lived access key.

Every failure path is closed by design. If KMS is unreachable or denies the call, the data key cannot
be unwrapped, encryption and decryption both fail, the request returns a generic 500, and a job fails
terminally with `crypto_failure`. There is no plaintext fallback and no partial write. Recovery is
restoring KMS access, not re-running anything: the affected requests were never committed.

Disabling or scheduling deletion of the KMS key makes every record encrypted under it unreadable,
including in backups. Treat it as data destruction.

## Backup and restore

Database backup and key recovery are separate requirements, and a backup is only useful with a key
that can still unwrap its data keys. Test both together:

1. Restore a disposable copy into an isolated environment.
2. Point `DATABASE_URL` at it and configure the wrapping key that copy's records were written under.
3. `pnpm verify:restore --workspace <uuid>`. It decrypts one record per covered table and prints
   `OK`, `FAIL`, or `EMPTY` per table. It never prints plaintext.
4. Check tenant isolation on the restored copy: a tenant transaction for one workspace must not read
   another's rows, which is what `tests/integration/tenant-context.test.ts` asserts against a fresh
   database.

Provider backup retention is the provider's, not ours. Deleting local data is not a promise of
provider-wide immediate deletion, and physical erasure from an existing backup cannot be claimed on
app-side deletion.

## Rollback

| Situation | Action |
| --- | --- |
| Bad application build | Redeploy the previous build. Migrations are additive, so no schema change has to be undone |
| Bad migration | Write a forward migration. Do not hand-edit `drizzle.__drizzle_migrations` |
| Worker misbehaving | Stop it. The API keeps serving and queued work waits; captures stay `processing` and nothing is lost |
| A purge started by mistake | It cannot be undone. The records are unreachable before the request returns and the job removes them. Restore from backup |
| A key retired by mistake | It cannot be undone. Restore the environment from a backup taken before the retirement |

## Known limitations

- **Codec inspection.** Video validation reads the container only: the `ftyp` brand, and the
  `moov`/`mvhd` movie header for the duration. It does not decode a frame, so it cannot tell that
  a well-formed MP4 uses a codec profile a given phone will not play. Playback failures are
  collected from devices, not predicted by the server (roadmap milestone 4 acceptance gate).
- **No transcoding.** A validated video is published exactly as uploaded. Adaptive streaming and
  transcoding are deferred (architecture §6). The 15-second and 20 MB limits are what keep this
  workable.
- **Signed URL revocation.** Read URLs last 60 seconds and are issued only after fresh
  authorization, but an already-issued URL keeps working until it expires, including for a
  caregiver revoked in the meantime. Access removal is not instant for URLs already handed out.
- **Raw audio retention.** Recordings are deleted seven days after their capture is confirmed, and
  abandoned captures are cancelled after seven days. Deleting the row is not deleting the object;
  both are tracked, and the reservation is released exactly once.
- **Idempotency responses outlive a child purge.** A retained response is an encrypted copy of a
  DTO, and a child purge does not remove them; they expire with their own retry window. A workspace
  purge does remove them.
- **Retirement is not scheduled.** A workspace purge demotes scope keys immediately but only retires
  them if the retention window has already passed when the job runs, which for a fresh deletion it
  has not. Nothing re-enqueues the job later; retirement is an operator action.
- **Metrics are per process.** Counters live in memory, so two API instances produce two snapshot
  lines and `GET /v1/internal/metrics` answers for whichever instance served the request. Aggregate
  from the log lines, not from a single endpoint read.

## Triage

| Symptom | Look at |
| --- | --- |
| Photos never leave "uploaded" | `validate_media` job rows: `last_error_code`, `attempts`. A missing sharp binary shows up as repeated generic failures |
| Photos are rejected immediately | The worker log line `{"event":"media_rejected", …}` carries a closed reason code (`mime_mismatch`, `unsupported`, `corrupt`, `too_large`, `too_long`) and no file content |
| A workspace cannot upload | `workspaces.storage_reserved_bytes + storage_used_bytes` against its budget. Reservations from abandoned uploads are released by `cleanup_uploads` after 24 hours |
| Bucket grows faster than `storage_used_bytes` | The reconciliation sweep is not running for that workspace, or is capped at 100 objects per day for a real backlog |
| A deleted child's records are still there | The `purge_child` job row: `status`, `attempts`, `last_error_code`, and its `checkpoint` stage. Confirm with `pnpm verify:purge` |
| Captures fail with `budget_exceeded` | `handoff.provider_usage` for that workspace and today, against `QUOTA_EXTRACTION_USD_PER_WORKSPACE_PER_DAY` |
| A caregiver sees "try again tomorrow" | `quota_refusals` labels say which ceiling; the per-user capture cap is the usual one |
| Everything fails with `crypto_failure` | KMS access. Nothing is written without a usable key, so there is no partial state to repair |

Logs carry job ids, kinds, counts, and closed error codes. They never carry a transcript, a file,
a signed URL, or a child's name; do not add any of those while debugging.
