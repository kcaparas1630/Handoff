-- Runtime access control for the Handoff API role.
-- Reviewed by hand: drizzle-kit does not model roles, grants, or row-level security policies.
-- Read top to bottom: role, grants, tenant isolation, identity lookups, provider role lockdown.

-- The runtime role owns nothing and cannot log in. Login users that inherit it (Supabase's
-- pooler user, a local developer role) are created out of band with their own credentials.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'handoff_api') THEN
		CREATE ROLE handoff_api NOLOGIN;
	END IF;
END $$;
--> statement-breakpoint

REVOKE ALL ON SCHEMA "handoff" FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA "handoff" TO handoff_api;--> statement-breakpoint

-- Table grants are enumerated, not wildcarded, so a future table is unreachable until its own
-- migration grants it. No DELETE is granted anywhere: milestone 1 has no delete path, and
-- deletion arrives with the purge capability in milestone 5.
GRANT SELECT, INSERT, UPDATE ON "handoff"."users" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."workspaces" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."workspace_memberships" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."data_keys" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."children" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."child_caregivers" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."invitation_intents" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."invitation_child_grants" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."idempotency_requests" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."webhook_inbox" TO handoff_api;--> statement-breakpoint
-- Audit records are append-only; the API may write and read them but never amend them.
GRANT SELECT, INSERT ON "handoff"."audit_log" TO handoff_api;--> statement-breakpoint

-- Tenant-owned tables. FORCE also subjects the table owner to these policies, so a mistaken
-- connection as the migration role does not silently bypass isolation.
ALTER TABLE "handoff"."workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."workspaces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."workspace_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."workspace_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."children" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."children" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."child_caregivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."child_caregivers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."invitation_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."invitation_intents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."invitation_child_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."invitation_child_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Every tenant policy compares against the transaction-local workspace context set by
-- withTenantTransaction(). A missing setting is NULL, and NULL = uuid is never true, so a query
-- without tenant context reads nothing and writes nothing. NULLIF covers the empty-string value
-- Postgres leaves behind after a transaction-local setting is reset on the pooled connection.
-- The workspace root compares its own id; every other tenant table compares workspace_id.
CREATE POLICY "workspaces_tenant_isolation" ON "handoff"."workspaces"
	FOR ALL TO handoff_api
	USING ("id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "workspace_memberships_tenant_isolation" ON "handoff"."workspace_memberships"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "children_tenant_isolation" ON "handoff"."children"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "child_caregivers_tenant_isolation" ON "handoff"."child_caregivers"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "invitation_intents_tenant_isolation" ON "handoff"."invitation_intents"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "invitation_child_grants_tenant_isolation" ON "handoff"."invitation_child_grants"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Bootstrap has no workspace yet: it resolves a verified Clerk subject to the workspaces that
-- subject belongs to. Data contract section 6 reserves this narrow non-tenant lookup, "for the
-- verified Clerk subject", so both policies are keyed to the caller rather than opened to
-- everyone. They are SELECT only, cover exactly these two tables, and are inactive whenever a
-- tenant context is set. Forgetting withTenantTransaction therefore reads nothing, not the whole
-- roster. Children, grants, and invitations stay unreadable without tenant context.
--
-- handoff.user_id  is the local UUID of the authenticated Clerk subject.
-- handoff.clerk_org_id is the organization the caller has already been verified an admin of.
CREATE POLICY "workspace_memberships_identity_lookup" ON "handoff"."workspace_memberships"
	FOR SELECT TO handoff_api
	USING (
		nullif(current_setting('handoff.workspace_id', true), '') IS NULL
		AND "user_id" = nullif(current_setting('handoff.user_id', true), '')::uuid
	);
--> statement-breakpoint

-- The clerk_org_id branch lets workspace initialization find-or-create by organization id after
-- the API has verified the caller's Clerk org admin membership. The EXISTS branch serves
-- bootstrap, and reads workspace_memberships under the policy directly above it.
CREATE POLICY "workspaces_identity_lookup" ON "handoff"."workspaces"
	FOR SELECT TO handoff_api
	USING (
		nullif(current_setting('handoff.workspace_id', true), '') IS NULL
		AND (
			"clerk_org_id" = nullif(current_setting('handoff.clerk_org_id', true), '')
			OR EXISTS (
				SELECT 1
				FROM "handoff"."workspace_memberships" m
				WHERE m."workspace_id" = "workspaces"."id"
					AND m."user_id" = nullif(current_setting('handoff.user_id', true), '')::uuid
					AND m."status" = 'active'
			)
		)
	);
--> statement-breakpoint

-- Supabase's PostgREST roles must never reach these tables. The guard keeps the migration
-- runnable on a plain Postgres instance, which has no such roles.
DO $$
DECLARE
	provider_role text;
BEGIN
	FOREACH provider_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = provider_role) THEN
			EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA "handoff" FROM %I', provider_role);
			EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA "handoff" FROM %I', provider_role);
			EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "handoff" FROM %I', provider_role);
			EXECUTE format('REVOKE ALL ON SCHEMA "handoff" FROM %I', provider_role);
		END IF;
	END LOOP;
END $$;
