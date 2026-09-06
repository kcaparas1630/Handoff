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

`0000_identity.sql` is generated, then hand-reordered so tables are created in dependency order
(`users` and `workspaces`, then `data_keys`, then children, then invitations) and so the unique
indexes that back composite foreign keys exist before those keys are added. Drizzle emits
statements grouped by kind, which put the composite foreign keys before their target index.

`0001_access.sql` is written by hand (`drizzle-kit generate --custom`) because drizzle-kit does
not model roles, grants, or policies.

## Tenant-scoped and identity-scoped tables

Tenant-scoped tables have row-level security enabled and forced, plus one policy for
`handoff_api` with matching `USING` and `WITH CHECK` conditions against the transaction-local
`handoff.workspace_id` setting:

`workspaces` (compares its own `id`), `workspace_memberships`, `children`, `child_caregivers`,
`invitation_intents`, `invitation_child_grants`.

Identity-scoped tables carry no tenant column that would make a policy meaningful, so they are
protected by grants and by the repositories that reach them:

`users`, `data_keys` (rows are workspace- or user-scoped), `idempotency_requests` (keyed by actor),
`webhook_inbox` (provider events), `audit_log` (records outlive the rows they describe).

## Transaction settings

Three transaction-local settings drive the policies. All are set with parameterized
`set_config(..., true)` inside a transaction, never interpolated and never session-global.

| Setting | Set by | Meaning |
| --- | --- | --- |
| `handoff.workspace_id` | `withTenantTransaction` | The authorized workspace for this request. Every tenant policy compares against it. |
| `handoff.user_id` | `withIdentityTransaction` / `setIdentityContext` | Local UUID of the authenticated Clerk subject. |
| `handoff.clerk_org_id` | `withIdentityTransaction` / `setIdentityContext` | Organization the API has already verified the caller administers. |

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
  `SELECT, INSERT, UPDATE`. No table grants `DELETE`; deletion arrives with the milestone 5 purge.
- **Index names** are explicit (`children_workspace_status_idx`,
  `child_caregivers_user_status_child_idx`, `workspace_memberships_user_status_idx`) so the
  required indexes in section 6 are greppable.
- **`data_keys` uniqueness** uses four partial unique indexes rather than table constraints. A
  plain unique over a nullable scope column would treat NULLs as distinct and enforce nothing.
