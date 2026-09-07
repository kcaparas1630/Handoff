-- Runtime access control for the milestone 5 purge capability and the provider spend counters.
-- Reviewed by hand: drizzle-kit does not model roles, grants, or row-level security.
-- Read top to bottom: provider_usage grants and tenant isolation, then the separately constrained
-- deletion capability the data contract reserves for the dispatcher credential.

-- Numbers only, keyed by workspace and UTC day. The worker records what it spent through the same
-- tenant-scoped credential every other job write uses.
GRANT SELECT, INSERT, UPDATE ON "handoff"."provider_usage" TO handoff_api;--> statement-breakpoint

ALTER TABLE "handoff"."provider_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."provider_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "provider_usage_tenant_isolation" ON "handoff"."provider_usage"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Data contract section 5: "Purge has a separately constrained maintenance capability." Row
-- removal is that capability, so it is granted to the queue credential and to nothing else. The
-- mobile API credential still holds no DELETE on any table: a request can mark a child or a
-- workspace inaccessible and enqueue the purge, and only a claimed job can remove rows.
--
-- The dispatcher's reach here is still one workspace at a time. These policies read the same
-- transaction-local `handoff.workspace_id` the API policies read, so the purge job opens a tenant
-- transaction on the dispatch connection using the workspace id from the trusted job row.
-- WITH CHECK (false) makes the direction explicit: this credential removes rows, never writes
-- them, even if a future grant were widened by mistake.
GRANT SELECT, DELETE ON "handoff"."event_revisions" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."events" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."media_assets" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."captures" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."care_sessions" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."handoff_cursors" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."handoff_briefs" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."child_caregivers" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."invitation_child_grants" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."invitation_intents" TO handoff_dispatcher;--> statement-breakpoint
GRANT SELECT, DELETE ON "handoff"."workspace_memberships" TO handoff_dispatcher;--> statement-breakpoint

-- A retained idempotency response is an encrypted copy of a DTO, so a purged workspace's rows go
-- with it. This table is identity scoped and carries no row-level security, so its grant stands
-- alone and the scope column is what narrows the statement.
GRANT SELECT, DELETE ON "handoff"."idempotency_requests" TO handoff_dispatcher;--> statement-breakpoint

-- 0005_media_and_jobs_access.sql left the queue without DELETE on purpose: "removal arrives with
-- the milestone 5 purge capability". A purged child's queue rows name a capture and an asset that
-- are about to stop existing, so they go with them.
GRANT DELETE ON "handoff"."jobs" TO handoff_dispatcher;--> statement-breakpoint

CREATE POLICY "event_revisions_dispatcher_purge" ON "handoff"."event_revisions"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "events_dispatcher_purge" ON "handoff"."events"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "media_assets_dispatcher_purge" ON "handoff"."media_assets"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "captures_dispatcher_purge" ON "handoff"."captures"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "care_sessions_dispatcher_purge" ON "handoff"."care_sessions"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "handoff_cursors_dispatcher_purge" ON "handoff"."handoff_cursors"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "handoff_briefs_dispatcher_purge" ON "handoff"."handoff_briefs"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "child_caregivers_dispatcher_purge" ON "handoff"."child_caregivers"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "invitation_child_grants_dispatcher_purge" ON "handoff"."invitation_child_grants"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "invitation_intents_dispatcher_purge" ON "handoff"."invitation_intents"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

CREATE POLICY "workspace_memberships_dispatcher_purge" ON "handoff"."workspace_memberships"
	FOR ALL TO handoff_dispatcher
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK (false);
--> statement-breakpoint

-- Supabase's PostgREST roles must never reach the new table either. Same guard as the earlier
-- access migrations, so this still runs on a plain Postgres instance.
DO $$
DECLARE
	provider_role text;
BEGIN
	FOREACH provider_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = provider_role) THEN
			EXECUTE 'REVOKE ALL ON "handoff"."provider_usage" FROM ' || quote_ident(provider_role);
		END IF;
	END LOOP;
END $$;
