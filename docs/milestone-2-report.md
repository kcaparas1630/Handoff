# Milestone 2 report: manual journal, concurrent care, deterministic handoff

Completed September 6, 2026. Measured against the [roadmap](implementation-roadmap.md)
milestone 2 gate. Unmeasured targets are marked; nothing below claims device verification.

## User-visible behavior implemented

- Child dashboard per [experience design](experience-design.md) section 1: identity header with
  active caregivers and last-synced time, handoff invitation with unread count, latest recorded
  feed/sleep/diaper tiles, quick care entry (Feed, Diaper, Sleep, Note, Milestone under More),
  recent updates, and care controls. Empty states show an example and a real entry action.
- Quick-entry sheet per section 2: per-kind fields, unit chips, Now / Earlier / Time unknown
  with nothing preselected, explicit Save, domain validation before submit, honest error state.
- Journal list with kind filters and an editor for corrections and removals with version checks.
- Handoff brief per section 4: boundary label, recent essentials with "before this window"
  labels, updates with updated/removed tags, moments, pending-recording count, staleness banner
  with refresh, and three distinct actions: read and start care, mark as read, close unread.
- Server: manual capture creation and confirmation as the only event-creating path, event
  corrections and deletions as immutable revisions under the child journal counter, one open
  care session per child and user, recipient-specific brief snapshots generated under
  repeatable read and stored encrypted, monotonic acknowledgement cursors, and the live overview
  projection that never advances a cursor.

## Paths changed

Contracts and domain (`packages/contracts`, `packages/domain`), database
(`packages/db/src/schema/{journal,care}.ts`, migrations `0002`/`0003`, repositories),
server (`packages/server/src/services/*`, `security/journal-fields.ts`), API routes
(`apps/api/src/app/v1/{captures,events,children,handoffs}`), client (`packages/api-client`,
`packages/ui`, `packages/features/src/{journal,handoff,care}`, app routes), tests. Commits
`ded3152` through the routes commit on `main`.

Manifest deviations: `packages/domain/src/lib/{zoned-time,fact-text}.ts`,
`packages/server/src/services/{capture-confirmation,handoff-acknowledgement,journal-fields}`,
`packages/db/src/repositories/overview.ts` gained `readOverviewMetadata`, and the hand edits to
generated migration `0002` are listed in `packages/db/migrations/README.md`.

## Commands run and results

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Clean |
| `pnpm test:unit` | 194 passed |
| `DATABASE_URL=… pnpm test:integration` | 123 passed, 1 skipped (performance, opt-in) |
| `HANDOFF_PERF=1 … journal-performance.test.ts` | See performance below |
| `pnpm build:api` | 21 routes exported |
| Native exports | Both apps bundle |

## Acceptance gate status

| Gate item | Status | Evidence or gap |
| --- | --- | --- |
| Feed with/without amount, diaper qualitative, sleep interval, milestone quote, planned note render from confirmed data | Verified | `brief-renderer.test.ts`, `event-service.test.ts` |
| 100 concurrent confirmations of one capture produce one event per candidate; same key different body returns 409 | Verified | `event-service.test.ts`, `api-routes.test.ts` |
| 100 concurrent care starts produce one session per user; independent sessions; ending A leaves B | Verified | `care-concurrency.test.ts`, `care-service.test.ts` |
| Late upload after cutoff, correction of older event, deletion after brief, pending draft, empty brief, first-visit window, stale acknowledgement, out-of-order devices, rollback after counter allocation | Verified | `handoff-boundaries.test.ts`, `journal-transactions.test.ts` |
| Every rendered fact has a source revision; no plan becomes a completed feed; unknown stays unknown | Verified | Renderer tests assert revision ids and planned-note wording |
| Event payloads, revisions, and briefs encrypted including replayed responses | Verified | `pii-storage.test.ts` marker dump |
| Overview finds latest care beyond the first page, preserves unknown-time uncertainty, per-user unread count, never acknowledges | Verified | `overview-access.test.ts` |
| p95 journal read and brief creation ≤ 500 ms against 10,000 revisions | Partial | Journal first page p95 18 ms; brief over 50 unacknowledged changes with 10,050 total revisions p95 100 ms; a single brief rendering all 10,000 changes p95 801 ms (SQL 21 ms; the rest is per-row decryption and rendering). Architecture section 5 already requires large windows to be grouped or paginated; that pagination is not built |
| On-device brief usable within two seconds in 20 runs | Not measured | Needs devices and a network |
| Quick-entry and handoff comprehension checks; populated, empty, unknown-time, pending, error, large-text, reader-only states | Not measured | Screens implement each state; the maintainer checklist below drives the check |

## Material limitations and follow-ups

- Runtime verification against hosted Clerk, devices, and Expo Go has not happened. Both Maestro
  flows under `tests/e2e` are written but unexecuted.
- Very large unacknowledged windows are rendered whole. Add grouped or paginated briefs before a
  pilot where a recipient could be away for days.
- Event cards attribute entries as "you" or "another caregiver" because the event DTO carries no
  display name; the brief carries names. Consider adding the author name to the event DTO.
- No `GET /v1/events/:eventId` exists; the editor resolves the event from loaded pages.
- The brief route records its replay row in a separate transaction from the brief insert because
  the service owns its isolation level. A crash between the two yields a duplicate immutable
  brief, not lost data.
- Id-only routes for captures, events, and briefs still search the caller's workspaces (capped at
  20); only children have an identity-scoped lookup.

## Device checklist for the maintainer

1. Dashboard: with recorded data, confirm name and workspace, the caring line, the handoff card
   with a count, three tiles labelled as recorded facts, and "time not given" on an unknown-time
   fact. Time a participant finding the latest feed and its time.
2. Quick entry: Diaper, Wet, Now, Save diaper in five timed runs. Confirm nothing is preselected,
   Save stays disabled until a time choice, an empty feed amount saves as "amount not recorded",
   and Earlier opens date then time in the workspace zone.
3. Handoff: open Read handoff; confirm the boundary heading, the first-handoff baseline caption,
   "before this window" essentials, updated/removed tags, expandable sources, and the pending
   count. Ask participants to distinguish reviewing, starting care, and marking read.
4. Honest states: empty child, unknown-time entry, a correction from a second device producing
   the 409 banner, airplane mode during save, and a reader account with disabled entry actions.
5. Large text, reduced motion, and screen readers on both platforms.
