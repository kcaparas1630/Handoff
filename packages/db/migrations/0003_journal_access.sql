-- Runtime access control for the journal, care, and handoff tables, plus the child identity
-- lookup that milestone 1 deferred.
-- Reviewed by hand: drizzle-kit does not model grants, policies, or row-level security.
-- Read top to bottom: grants, tenant isolation, child identity lookup.

-- Same shape as 0001_access.sql: enumerated tables, and no DELETE anywhere. Deletion arrives
-- with the purge capability in milestone 5.
GRANT SELECT, INSERT, UPDATE ON "handoff"."captures" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."events" TO handoff_api;--> statement-breakpoint
-- Revisions are immutable, but UPDATE is granted for symmetry with the other tables; the event
-- repository is the only writer and never issues an update against them.
GRANT SELECT, INSERT, UPDATE ON "handoff"."event_revisions" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."care_sessions" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."handoff_cursors" TO handoff_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "handoff"."handoff_briefs" TO handoff_api;--> statement-breakpoint

-- All six tables carry workspace_id, so all six are tenant scoped. FORCE also subjects the table
-- owner to these policies.
ALTER TABLE "handoff"."captures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."captures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."event_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."event_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."care_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."care_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."handoff_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."handoff_cursors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."handoff_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."handoff_briefs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Identical in shape to the milestone 1 tenant policies: a missing setting is NULL, NULL = uuid
-- is never true, and NULLIF covers the empty string a reset transaction-local setting leaves on
-- a pooled connection. Child-level permission is still enforced by the services; tenant RLS
-- alone does not separate children inside one daycare.
CREATE POLICY "captures_tenant_isolation" ON "handoff"."captures"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "events_tenant_isolation" ON "handoff"."events"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "event_revisions_tenant_isolation" ON "handoff"."event_revisions"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "care_sessions_tenant_isolation" ON "handoff"."care_sessions"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "handoff_cursors_tenant_isolation" ON "handoff"."handoff_cursors"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "handoff_briefs_tenant_isolation" ON "handoff"."handoff_briefs"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Milestone 1 follow-up. A request that names a child but not a workspace has to resolve the
-- child's workspace before it can open a tenant transaction. Mirrors workspaces_identity_lookup:
-- SELECT only, inactive whenever a tenant context is set, and keyed to the caller through an
-- active membership rather than opened to every child row.
CREATE POLICY "children_identity_lookup" ON "handoff"."children"
	FOR SELECT TO handoff_api
	USING (
		nullif(current_setting('handoff.workspace_id', true), '') IS NULL
		AND EXISTS (
			SELECT 1
			FROM "handoff"."workspace_memberships" m
			WHERE m."workspace_id" = "children"."workspace_id"
				AND m."user_id" = nullif(current_setting('handoff.user_id', true), '')::uuid
				AND m."status" = 'active'
		)
	);
