# Milestone 1 report: shared foundation, identity, child onboarding, invitations

Completed September 6, 2026. This records what was actually built and verified against the
[roadmap](implementation-roadmap.md) milestone 1 gate. Targets that were not measured are marked
as such; nothing below claims device or hosted-Clerk verification that did not happen.

## User-visible behavior implemented

- Parents and Daycare Expo apps with email-code sign-in, workspace and first-child onboarding,
  a child roster, a child profile, and an invitation screen. Both apps share every screen and
  component; only flavor configuration differs.
- API on Node (Expo Router routes behind an Express adapter) implementing every milestone 1
  endpoint in the [data contract](data-contract.md) section 8, plus a server-rendered invitation
  landing page.
- Postgres schema in a private `handoff` schema with tenant row-level security, composite
  foreign keys, encrypted profile and invitee columns, scoped data keys, idempotency, webhook
  inbox, and audit tables.

## Paths changed

`apps/{parents,daycare,api}`, `packages/{config,contracts,domain,db,server,api-client,mobile,ui,features}`,
`tests/integration`, `tests/e2e`, `docker-compose.yml`, root tooling. One commit per reviewed task
on `main` from `65b8dc0` through `4946226`.

Manifest deviations: `apps/api/src/app/accept-invitation+api.ts` replaces the planned `.tsx`
(server-only app links); Drizzle numbers migrations from `0000`, mapped in
`packages/db/migrations/README.md`; `packages/server/src/security/encryption/field-encryption.ts`,
`packages/server/src/lib/in-tenant-transaction.ts`, and `packages/server/src/services/workspace-lookup.ts`
were added beyond the manifest and are explained in their headers.

## Commands run and results

| Command | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Clean across root and all app/package projects |
| `pnpm test:unit` | 111 passed |
| `DATABASE_URL=… pnpm test:integration` (Postgres 17 in Docker) | 61 passed across 7 files |
| `pnpm --filter @handoff/parents export`, `… daycare export` | iOS and Android bundles produced |
| `pnpm build:api` then `tsx apps/api/server.ts` | 11 routes exported; health 200, unauthenticated bootstrap 401 envelope, landing page 200 with CSP and no echoed ticket |

## Acceptance gate status

| Gate item | Status | Evidence or gap |
| --- | --- | --- |
| Both apps boot and render a shared child card; lint/typecheck/API export pass | Partial | Exports and checks pass. Device boot is not verified; see the device checklist below |
| Exported API authenticates a real Clerk test token and performs a tenant-scoped write; missing tenant context fails | Partial | Token verification is exercised only through a fake gateway. RLS denial without context, and 20 alternating pooled requests across two tenants, are verified in `tenant-context.test.ts` |
| New/existing account, revoked, expired, duplicate callback, delayed webhook, wrong recipient; ten duplicate deliveries yield one grant set | Verified with a fake Clerk gateway | `invitations.test.ts`. Delayed-webhook ordering relies on the webhook service fetching current provider state; not exercised against hosted Clerk |
| Two workspaces, two children, owner/staff/guardian; forbidden reads/writes fail | Verified locally | `identity-access.test.ts` and `api-routes.test.ts` |
| Guardian cannot read the daycare roster through Clerk's own APIs | Not verified | Requires configuring the custom guardian role in the Clerk dashboard and testing Clerk's frontend endpoints |
| Synthetic markers absent from plaintext dumps, inbox, idempotency rows; tampering and swapping fail closed | Verified | `pii-storage.test.ts`, `encrypted-invitations.test.ts`, and the encryption unit tests. Log output was not scanned systematically |
| Development keys rejected in a production configuration | Verified | `config/env.test.ts` |
| Median account-ready-to-child-created time ≤ 2 minutes in five runs | Not measured | Needs real devices and a Clerk development instance |

## Material limitations and follow-ups

- No Clerk or Supabase credentials were available. Everything that touches Clerk runs against
  `tests/integration/support/fake-clerk-gateway.ts`. `tests/e2e/onboarding-invitation.yaml` is
  written but unexecuted.
- Token verification does not yet pin authorized parties or audience; add before pilot.
- `ensureFreshMembership` calls Clerk while a tenant transaction is open. It holds no row locks,
  but it should move outside the transaction when milestone 2 introduces child locks.
- Two concurrent requests with the same idempotency key make the loser fail with 500 instead of
  returning the replay; the business write still happens once. Milestone 2 should lock the
  idempotency row before executing.
- Child and invitation routes that carry only an id resolve the workspace by trying the
  caller's active workspaces (capped at 20). Milestone 2 should add an identity-scoped
  `child_id → workspace_id` lookup.
- Reanimated 4 with NativeWind 4 is untested at runtime; no component uses animation classes.
- Dark-mode token contrast is unmeasured.

## Device checklist for the maintainer

Run with `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL` set, the API started with
the server environment from `.env.example`, and Postgres migrated with `pnpm db:migrate`.

1. Start either app with one public variable unset: the screen names only that variable.
2. Sign in with an email code; a wrong code shows a readable message, not a provider object.
3. Onboarding creates the Clerk organization, the workspace with the detected time zone, and the
   first child; a blank birthdate stays blank.
4. The roster shows the child; the daycare flavor shows the workspace name as the heading and a
   permission line per child. Nothing renders before the server responds.
5. Invite a second account by email with one child grant; the invitation appears after the list
   refetches; revoke shows only for open invitations.
6. Accept the invitation on the second account; after sign-in and bootstrap it sees only the
   granted child and cannot open the invitations screen.
7. Sign out; the next account starts with an empty cache and no selected workspace.
