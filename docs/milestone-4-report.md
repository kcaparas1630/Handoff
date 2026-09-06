# Milestone 4 report: photos, short videos, private access, interrupted uploads

Completed September 6, 2026. Measured against the [roadmap](implementation-roadmap.md)
milestone 4 gate. Provider and device gates remain unmeasured for the same reason as milestone
3: no Supabase project, no devices. Everything else below was verified against real Postgres
with an in-memory object store standing in for the bucket.

## User-visible behavior implemented

- Add photo or video after saving a recording, during review, and from the event editor of a
  confirmed entry, up to three per capture. Photos are resized and re-encoded on device so no
  location metadata leaves the phone; videos are checked against the 15-second and 20 MB limits.
- Attachments walk through the same durable outbox as recordings, with tiles that read On this
  phone, Awaiting validation, or the picture itself. Signed URLs are fetched on demand and never
  persisted; sign-out clears them and deletes local files after a notice.
- Attachments appear on journal entries, the dashboard, the event editor, and the brief, where a
  capture's attachments are shown once per section.
- Server: quota reservation before any provider call, server-generated object keys, byte-level
  MIME inspection, image normalization that strips metadata, MP4 container duration parsing,
  ready-only signing with a 60-second TTL, audio restricted to author and owner, and publication
  of ready assets as `media_updated` revisions under the child lock, exactly once per event.
- Abandoned uploads and orphan objects are cleaned by a daily job that releases quota once.

## Paths changed

Contracts (`media.ts` additions), database (`cleanup_uploads` job kind, migration `0006`,
media repository additions), server (`services/media.ts`, `media/`, `jobs/validate-media.ts`,
`jobs/cleanup-uploads.ts`, storage port additions), worker registration, API routes (`assets`,
`assets/[assetId]/{complete,index}`), mobile (`media/`, attachment outbox), features
(`AttachmentPicker`, `AttachmentViewer`), UI (`AttachmentTile`, `AttachmentStrip`),
`docs/runbook.md`, tests. Commits `902059f` through the routes commit on `main`.

Manifest deviations: `media/lib/mp4-duration.ts`, `media/lib/attachment-limits.ts`,
`packages/mobile/src/media/attachment-storage.ts`, and `packages/ui/src/AttachmentStrip.tsx`
were added beyond the manifest; the runbook was created here because sharp's native binary is
a deployment requirement.

## Commands run and results

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck` (13 projects), `pnpm format:check` | Clean |
| `pnpm test:unit` | 334 passed |
| `DATABASE_URL=… pnpm test:integration` | 221 passed, 1 skipped (opt-in performance) |
| `pnpm build:api` | 26 routes exported |
| Native exports | Both apps bundle with the picker, manipulator, and video player |

## Acceptance gate status

| Gate item | Status | Evidence or gap |
| --- | --- | --- |
| Author, owner, linked reader, wrong child, wrong tenant, revoked member matrix for image and video signing; other caregivers cannot sign raw audio | Verified | `media-access.test.ts`, `api-routes.test.ts` |
| MIME spoof, excessive size or duration, path tampering, overwrite, missing upload, unsupported container, quota race, duplicate completion, expired token, orphan object | Verified | `media-lifecycle.test.ts`; path tampering is impossible by construction because keys are server-generated and the request schema has no key field |
| A rejected or unvalidated upload is never shown as ready; a cleaned object leaves no working reference | Verified | Unready reads are 404; cleanup deletes the object and releases quota once |
| No GPS fields in published images; server-normalized output inspected | Verified | The normalizer's output has no EXIF against an input written with EXIF; on-device preparation also re-encodes |
| A replayed publish job creates one attachment publication per event | Verified | `worker-recovery.test.ts` and the lifecycle test |
| Photo and video complete and play on iOS and Android; first image ≤ 2 s for ≤ 1 MB | Not verified | Needs devices and a Supabase bucket; see the checklist |
| Content does not appear across account switches; users see which files are device-local or awaiting validation | Partial | Tile states and per-user scoping are implemented and unit-tested; the switch itself needs a device |

## Material limitations and follow-ups

- Codec inspection is container-only: a well-formed MP4 with an unplayable codec profile passes
  validation. Collect playback failures from real devices and add a codec check if needed.
- No transcoding; the size and duration limits are what keep that workable.
- There is no re-signing endpoint for an expired attachment upload authorization; the client
  starts over with a new asset and the abandoned one is cleaned after 24 hours.
- An upload authorization is retained in the encrypted idempotency record so a dropped
  connection can replay it; read URLs are never retained.
- Orphan reconciliation is capped at 100 objects per workspace per day.
- sharp is a native module; the worker image must install its platform binary (see the runbook).
- The Maestro media flow is unexecuted and contains three manual picker steps.

## Device checklist for the maintainer

Requires a provisioned private bucket (`pnpm storage:provision`), the worker running with sharp
installed, and a simulator or device library seeded with a photo and a short video.

1. Attach a photo and a 10-second video after saving a recording; watch the tile move from On
   this phone to Awaiting validation to the picture; open the photo full-screen and play the
   video with native controls. Repeat with Take photo.
2. Measure first image display for a ≤ 1 MB image five times cold on the documented network;
   report median and worst case per platform.
3. Sign out with a pending attachment; confirm the notice, that the file is deleted, and that a
   second account uploads nothing and sees no tiles from the first.
4. In airplane mode, add a photo and confirm the On this phone state survives a force-quit;
   restore the network and confirm it advances.
5. Acknowledge a brief, then attach a photo to that entry; confirm the next brief shows the
   entry as updated with the attachment.
