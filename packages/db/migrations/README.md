# Handoff migrations

Only the migrator applies schema changes. There is no application-startup `push`.

Run with `DATABASE_MIGRATION_URL=... pnpm db:migrate`. Regenerate the table migration with
`DATABASE_MIGRATION_URL=... pnpm db:generate` after editing `packages/db/src/schema/*.ts`.
`DATABASE_MIGRATION_URL` is required by `drizzle.config.ts` even for `generate`, which never
connects; there is deliberately no default connection string.

## File names

Drizzle numbers migrations from `0000`. The roadmap names them from `0001`.

| Generated file | Roadmap name | Contents |
| --- | --- | --- |
| `0000_identity.sql` | `0001_identity.sql` | Schema, enums, tables, indexes, foreign keys |
| `0001_access.sql` | `0002_access.sql` | `handoff_api` role, grants, row-level security |
| `0002_journal_and_care.sql` | `0003_journal_and_care.sql` | Captures, events, revisions, care sessions, cursors, briefs |
| `0003_journal_access.sql` | — | Grants and policies for those six tables, plus the children lookup policy |
| `0004_media_and_jobs.sql` | `0004_media_and_jobs.sql` | Media assets and the durable job queue |
| `0005_media_and_jobs_access.sql` | — | Grants, tenant policy for media, and the dispatcher role and queue policies |
| `0006_cleanup_uploads_job.sql` | — | Adds the `cleanup_uploads` job kind for the milestone 4 upload and orphan-object sweep |
| `0007_purge_quotas_and_rotation.sql` | — | The `rotate_data_keys` job kind, the `provider_usage` spend counters, and `workspaces.deleted_at` |
| `0008_purge_access.sql` | — | Grants and policies for `provider_usage`, and the dispatcher's deletion capability |

`0000_identity.sql` is generated, then hand-reordered so tables are created in dependency order
(`users` and `workspaces`, then `data_keys`, then children, then invitations) and so the unique
indexes that back composite foreign keys exist before those keys are added. Drizzle emits
statements grouped by kind, which put the composite foreign keys before their target index.

`0001_access.sql` is written by hand (`drizzle-kit generate --custom`) because drizzle-kit does
not model roles, grants, or policies.

`0002_journal_and_care.sql` is generated, then hand edited three times. The roadmap names it
`0003_journal_and_care.sql`; the snapshot in `meta/0002_snapshot.json` stays exactly as generated,
so `pnpm db:generate` still reports no drift and none of these edits are reapplied by tooling.

| Hand edit | Why |
| --- | --- |
| Every `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` moved below the `CREATE …INDEX` block | Same reordering `0000_identity.sql` needed: drizzle groups statements by kind and emits composite foreign keys before the unique indexes that back them |
| `"time_precision" time_precision` → `"time_precision" "handoff"."time_precision"` | drizzle-kit decides a column type is a built-in with `type.startsWith(nativeType)`, and `time_precision` starts with `time`, so it drops the schema qualification. The type lives in `handoff`, which is not on the migration role's `search_path`. The snapshot records the type correctly; only the emitted SQL is wrong. Expect this on any future statement that emits this column's type |
| `events_current_revision_fk` gains `DEFERRABLE INITIALLY DEFERRED` | Drizzle cannot declare it. `events.current_revision_id` and `event_revisions.event_id` point at each other, so the pair is only consistent at commit. The constraint is declared in `schema/journal.ts` and appears in the snapshot without the deferral, which is the one place the snapshot and the database differ |

`0003_journal_access.sql` is written by hand for the same reason as `0001_access.sql`. It has no
roadmap name: milestone 2 lists only the table migration, and splitting access out keeps the two
kinds of review separate.

`0004_media_and_jobs.sql` is generated as `0004_kind_whiplash.sql`, renamed, and its journal tag
updated. Drizzle's numbering happens to match the roadmap name this time. One hand edit: every
`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` moved below the `CREATE …INDEX` block, because
`jobs_asset_fk` references `media_assets (workspace_id, child_id, id)` and drizzle emits that
foreign key before the unique index backing it. The snapshot in `meta/0004_snapshot.json` stays
exactly as generated, so `pnpm db:generate` still reports no drift.

`0005_media_and_jobs_access.sql` is written by hand for the same reason as the other access
migrations.

`0006_cleanup_uploads_job.sql` is generated and renamed. It is a single `ALTER TYPE … ADD VALUE`,
which PostgreSQL 12 and later accept inside a transaction as long as the new value is not used in
the same transaction; nothing else in the file reads it.

`0007_purge_quotas_and_rotation.sql` is generated and renamed, with a comment header added by hand.
It carries another `ALTER TYPE … ADD VALUE`, under the same rule: nothing in the file uses the new
`rotate_data_keys` value. `provider_usage` holds numbers only — tokens in, tokens out, and audio
seconds per workspace per UTC day — which is what the extraction spend cap reads before it lets a
model call happen. `workspaces.deleted_at` exists because the scope-key retention window has to be
measured from when deletion was *requested*; `updated_at` moves whenever a later purge stage touches
the row, so it cannot answer that question.

`0008_purge_access.sql` is written by hand for the same reason as the other access migrations.

## Tenant-scoped and identity-scoped tables

Tenant-scoped tables have row-level security enabled and forced, plus one policy for
`handoff_api` with matching `USING` and `WITH CHECK` conditions against the transaction-local
`handoff.workspace_id` setting:

`workspaces` (compares its own `id`), `workspace_memberships`, `children`, `child_caregivers`,
`invitation_intents`, `invitation_child_grants`, `captures`, `events`, `event_revisions`,
`care_sessions`, `handoff_cursors`, `handoff_briefs`, `media_assets`.

`jobs` has row-level security too, but its policies are keyed to the credential rather than only
to the tenant; see the dispatcher section below.

Tenant isolation is not child isolation. One daycare workspace holds many children, and the
policies above cannot tell them apart; child services still check `child_caregivers` grants.

Identity-scoped tables carry no tenant column that would make a policy meaningful, so they are
protected by grants and by the repositories that reach them:

`users`, `data_keys` (rows are workspace- or user-scoped), `idempotency_requests` (keyed by actor),
`webhook_inbox` (provider events), `audit_log` (records outlive the rows they describe).

## The queue and its two credentials

Data contract section 5 says the dispatcher credential "can claim queue entries but is not the
mobile API credential". Claiming a job is an `UPDATE`, so `0005_media_and_jobs_access.sql` creates
a second `NOLOGIN` role, `handoff_dispatcher`, and splits the queue by role:

| Role | Grants on `handoff.jobs` | Policy |
| --- | --- | --- |
| `handoff_dispatcher` | `SELECT, INSERT, UPDATE, DELETE` | `jobs_dispatcher_access`: every row, no tenant filter |
| `handoff_api` | `SELECT, INSERT` | `jobs_api_tenant_read` and `jobs_api_tenant_insert`, both against `handoff.workspace_id` |

The queue is deliberately global. Reconcile and maintenance jobs have no workspace at all, and a
claim cannot filter by a tenant the worker has not resolved yet, so a tenant policy would make the
table unusable for its own purpose. Restricting the *credential* instead is what keeps a mobile
request from taking a lease. The dispatcher reaches exactly one table: everything a claimed job
then does to captures, assets, and events runs in a tenant transaction on the API credential,
using the workspace id from the trusted job row.

`withJobTransaction` in `tenant-transaction.ts` is a plain `db.transaction` with no `set_config`,
because there is no context to set; the reach is the credential. Run it on
`DATABASE_JOB_DISPATCH_URL`.

## The deletion capability

Data contract section 5 also says "purge has a separately constrained maintenance capability".
`0008_purge_access.sql` makes that the dispatcher credential, and nothing else: it is the only role
in the database holding `DELETE` on any application table. The API role still holds none, so a
mobile request can mark a child or a workspace inaccessible and enqueue the purge, and only a
claimed job can remove a row.

The dispatcher's reach over those tables is still one workspace at a time. Each purge table carries
a `*_dispatcher_purge` policy against the same transaction-local `handoff.workspace_id` the API
policies read, so the purge job opens a *tenant* transaction on the dispatch connection using the
workspace id from the trusted job row. Every policy is `WITH CHECK (false)`: this credential removes
rows, never writes them, even if a grant were widened by mistake.

| Table | Dispatcher grants | Why |
| --- | --- | --- |
| `event_revisions`, `events`, `captures`, `media_assets` | `SELECT, DELETE` | The child's journal and its uploads |
| `care_sessions`, `handoff_cursors`, `child_caregivers`, `invitation_child_grants` | `SELECT, DELETE` | Everything that hangs off a child |
| `handoff_briefs`, `invitation_intents`, `workspace_memberships` | `SELECT, DELETE` | Workspace purge only; a child purge redacts briefs instead |
| `idempotency_requests` | `SELECT, DELETE` | Retained responses are encrypted copies of DTOs. Identity scoped, so no policy applies and the scope column is the filter |
| `jobs` | adds `DELETE` | A purged child's queue rows name captures and assets that are about to stop existing |

`children` is deliberately **not** on that list. A purge marks the child row through the API
credential and leaves it as a `deleted` tombstone with an encrypted empty profile, because the
retained redacted briefs and the audit log still point at it. Deleting rows that hang off a child is
the capability; deleting the child's identity is not.

`handoff_api` is deliberately *not* granted `UPDATE` on `jobs`, which is the one place these
migrations narrow what the milestone brief listed. With `UPDATE` the mobile API credential could
issue a claim, which is precisely the capability the contract reserves. Cancelling a discarded
capture's jobs therefore runs on the dispatcher credential.

## Transaction settings

Three transaction-local settings drive the policies. All are set with parameterized
`set_config(..., true)` inside a transaction, never interpolated and never session-global.

| Setting | Set by | Meaning |
| --- | --- | --- |
| `handoff.workspace_id` | `withTenantTransaction` | The authorized workspace for this request. Every tenant policy compares against it. |
| `handoff.user_id` | `withIdentityTransaction` / `setIdentityContext` | Local UUID of the authenticated Clerk subject. Also gates `children_identity_lookup`, which lets `childrenRepository.findChildWorkspaceForMember` resolve a child's workspace before a tenant transaction can be opened. |
| `handoff.clerk_org_id` | `withIdentityTransaction` / `setIdentityContext` | Organization the API has already verified the caller administers. |

`children` carries a third `SELECT`-only lookup policy, `children_identity_lookup`, added in
`0003_journal_access.sql`. Routes such as `GET /children/:childId/events` name a child and no
workspace, so the workspace has to be resolved first; the alternative is fanning out over every
workspace the caller belongs to. The policy is shaped like `workspaces_identity_lookup`: `SELECT`
only, inactive whenever `handoff.workspace_id` is set, and satisfied only by an active membership
in that child's workspace. Membership is not child permission, so the service still checks the
`child_caregivers` grant after it opens the tenant transaction.

Invitations deliberately do **not** get an equivalent lookup. An invitation id is a bearer-shaped
value handed to someone who may not be a member yet, so `GET /invitations/:invitationId` keeps
resolving through the caller's memberships instead of reading the intent first.

`workspaces` and `workspace_memberships` additionally carry a `SELECT`-only
`*_identity_lookup` policy that applies **only when no tenant context is set**, which data contract
section 6 reserves as a narrow non-tenant lookup "for the verified Clerk subject". Each policy is
keyed to the caller rather than open: memberships are visible only where `user_id` matches
`handoff.user_id`, and a workspace is visible only when its `clerk_org_id` matches
`handoff.clerk_org_id` or the caller holds an active membership in it. A request that forgets
`withTenantTransaction` and sets no identity context therefore reads nothing at all. Setting
`handoff.workspace_id` disables both lookup policies, so a tenant-scoped request can never widen
its reach through them.

`setIdentityContext` exists because bootstrap upserts the user row before it knows the local user
id: `users` carries no policy, so the write happens first and the setting is applied in the same
transaction before any membership or workspace read.

## Decisions made where the contract was ambiguous

- **Enums, not checked text.** Section 1 allows either "consistently selected in implementation".
  All enumerations are Postgres enums declared in the `handoff` schema.
- **`membership_status` is shared** by `workspace_memberships.status` and `child_caregivers.status`;
  both are `active|revoked` and `@handoff/contracts` already reuses one schema for them.
- **`users` has no `version` column.** Section 2 lists "timestamps" for `users` and
  "timestamps/version" for every other mutable entity; no user DTO carries a version.
- **Ciphertext columns are `NOT NULL`** wherever section 2 omits the `?` marker, including
  `users.profile_ciphertext`. A user with no display name stores an encrypted null, not a null
  column, so there is never a plaintext-shaped absence to interpret.
- **`idempotency_requests` scope** is modelled as `scope_kind` plus a nullable
  `scope_workspace_id`, with a check tying them together. A user-scoped row uses its
  `actor_user_id` as the scope, so no second nullable user column is needed.
- **`audit_log` and `webhook_inbox` have no foreign keys.** An audit record must survive the purge
  of what it describes, and inbox rows reference provider IDs rather than local rows.
- **`audit_log` is granted `SELECT, INSERT` only.** Every other table the API touches is granted
  `SELECT, INSERT, UPDATE`. The API role still grants `DELETE` on nothing at all; milestone 5 gave
  that capability to the dispatcher credential instead (see "The deletion capability").
- **Index names** are explicit (`children_workspace_status_idx`,
  `child_caregivers_user_status_child_idx`, `workspace_memberships_user_status_idx`) so the
  required indexes in section 6 are greppable.
- **`data_keys` uniqueness** uses four partial unique indexes rather than table constraints. A
  plain unique over a nullable scope column would treat NULLs as distinct and enforce nothing.
- **`bigint` counters are read as JavaScript numbers.** `children.journal_seq`,
  `handoff_cursors.acknowledged_seq`, and the brief window bounds use Drizzle's
  `{ mode: "number" }`. A child journal will not approach 2^53, and a string counter would push
  arithmetic into every caller.
- **The revisions unique index doubles as the required read index.** Section 6 asks for
  `(child_id, journal_seq)` on `event_revisions`; `event_revisions_child_journal_seq_key` already
  is that index, so there is no second copy of it.
- **`events` carries a second display index.** Section 6 asks for
  `(workspace_id, child_id, occurred_at DESC, id)` "with a consistent null-time display ordering".
  Unknown-time events sort last under `NULLS LAST`, and `events_child_created_idx` serves the
  fallback ordering the timeline uses for them.
- **`handoff_cursors.last_acknowledged_brief_id` has a plain foreign key** to `handoff_briefs`.
  Section 4 enumerates only the composite keys to child and membership, but section 1 requires
  relationships to be foreign keys, and briefs never point back at cursors, so there is no cycle.
- **`care_sessions_child_open_idx`** is not in section 6. Listing who is caring for a child right
  now is the overview's hottest read, and the partial unique index is keyed on `(child_id, user_id)`
  rather than the workspace, so it cannot serve that query.
- **`events` and `event_revisions` annotate their extra-config callbacks** with
  `PgTableExtraConfigValue[]`. The two tables reference each other, which TypeScript cannot infer
  through; the annotation is the same escape hatch Drizzle documents for self-referencing keys.
- **`media_assets.cleanup_state` is one enum, not two flags.** Section 3 asks for stored cleanup
  state "so retries cannot decrement totals twice". `quota_released` means the reservation no
  longer sits in `storage_reserved_bytes`, whether it was settled into `storage_used_bytes` on
  validation or released after rejection or expiry; `object_deleted` records that the storage
  object is gone. `markAssetDeleted` keeps whichever marker is further along, so the two paths
  cannot erase each other. Decrementing `storage_used_bytes` when an already-settled asset is
  deleted has no repository yet; it belongs with the milestone 5 purge capability.
- **`provider_usage` is a counter table, not a ledger.** One row per workspace per UTC day holding
  three totals. It records no capture id, no user, and no time of day, because the only question it
  answers is "has this workspace spent its budget today".
- **Re-encryption does not bump a row's `version` or `updated_at`.** Rotating a data key is
  maintenance, not an edit: a client holding an expected version must not lose its next write to a
  background job, and no journal sequence is allocated.
- **Quota moves do not bump `workspaces.version` or `updated_at`.** Same reasoning as the child
  journal counter: reserving bytes is not a profile edit, and bumping the version would break
  optimistic concurrency for a caller renaming the workspace.
- **`jobs` has composite foreign keys to child, capture, and asset.** All three columns are
  nullable and Postgres composite keys are `MATCH SIMPLE`, so each key applies only once every one
  of its columns is set. A reconcile job with no workspace is unconstrained; a `validate_media`
  job cannot name an asset from another tenant.
- **`jobs` has no `version` column.** Section 5 lists "timestamps" for it, and the lease token is
  what a worker's writes are checked against, so a second edit counter would mean nothing.
