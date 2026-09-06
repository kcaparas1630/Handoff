# Handoff operations runbook

What an operator has to get right for the deployed system to work, and what to check when it does
not. It covers the deployment requirements introduced with media handling in milestone 4; the
service architecture is in [architecture.md](architecture.md), and configuration variables are
named (never valued) in `.env.example`.

## Processes

| Process | Entry point | Needs |
| --- | --- | --- |
| API | `apps/api` (Expo Router API routes) | `DATABASE_URL`, Clerk, storage, PII key provider |
| Worker | `apps/worker` | everything the API needs, plus `DATABASE_JOB_DISPATCH_URL`, Deepgram, Anthropic, and the sharp native binary |
| Migrator | `pnpm db:migrate` | `DATABASE_MIGRATION_URL` only |

The API never claims jobs and the worker serves no HTTP traffic. They use different database
roles: `handoff_api` is tenant scoped and cannot take a job lease, `handoff_dispatcher` reaches
only the queue. Deploying the worker with the API's connection string silently disables the queue.

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

Both sweeps re-enqueue tomorrow's run before reporting success, so the chain survives a crash but
not a workspace with no traffic at all. A workspace whose sweeps have stopped starts again on its
next upload. To restart one by hand, enqueue a row with the dedupe key
`cleanup_uploads:<workspaceId>:<YYYY-MM-DD>`.

`cleanup_uploads` also reconciles the bucket against the database: it lists up to 100 objects
under the workspace's own prefix and deletes any whose asset id has no row. It is bounded per run
on purpose, so a large backlog drains over several days rather than in one long transaction.

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

## Triage

| Symptom | Look at |
| --- | --- |
| Photos never leave "uploaded" | `validate_media` job rows: `last_error_code`, `attempts`. A missing sharp binary shows up as repeated generic failures |
| Photos are rejected immediately | The worker log line `{"event":"media_rejected", …}` carries a closed reason code (`mime_mismatch`, `unsupported`, `corrupt`, `too_large`, `too_long`) and no file content |
| A workspace cannot upload | `workspaces.storage_reserved_bytes + storage_used_bytes` against its budget. Reservations from abandoned uploads are released by `cleanup_uploads` after 24 hours |
| Bucket grows faster than `storage_used_bytes` | The reconciliation sweep is not running for that workspace, or is capped at 100 objects per day for a real backlog |

Logs carry job ids, kinds, counts, and closed error codes. They never carry a transcript, a file,
a signed URL, or a child's name; do not add any of those while debugging.
