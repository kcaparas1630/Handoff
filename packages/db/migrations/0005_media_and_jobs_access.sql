-- Runtime access control for media assets and the durable job queue.
-- Reviewed by hand: drizzle-kit does not model roles, grants, or row-level security.
-- Read top to bottom: media grants and tenant isolation, then the dispatcher role and the two
-- credentials' separate reach over the queue.

GRANT SELECT, INSERT, UPDATE ON "handoff"."media_assets" TO handoff_api;--> statement-breakpoint

-- media_assets carries workspace_id, so it is tenant scoped like every other child-owned table.
-- FORCE also subjects the table owner to the policy.
ALTER TABLE "handoff"."media_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."media_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "media_assets_tenant_isolation" ON "handoff"."media_assets"
	FOR ALL TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid)
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Data contract section 5: "The dispatcher credential can claim queue entries but is not the
-- mobile API credential." Claiming a job is an UPDATE, so the two capabilities are separated by
-- role rather than by convention. Like handoff_api, this role owns nothing and cannot log in;
-- the worker's login user inherits it through DATABASE_JOB_DISPATCH_URL.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'handoff_dispatcher') THEN
		CREATE ROLE handoff_dispatcher NOLOGIN;
	END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "handoff" TO handoff_dispatcher;--> statement-breakpoint

-- The dispatcher reaches exactly one table. Everything a job then does to captures, assets, and
-- events runs in a tenant transaction on the API credential, using the claimed job's workspace.
GRANT SELECT, INSERT, UPDATE ON "handoff"."jobs" TO handoff_dispatcher;--> statement-breakpoint

-- The API enqueues work and reports capture progress. It is deliberately not granted UPDATE:
-- with it, the mobile API credential could take a lease, which is the capability the contract
-- reserves for the dispatcher. Cancelling a discarded capture's jobs runs on the dispatcher.
GRANT SELECT, INSERT ON "handoff"."jobs" TO handoff_api;--> statement-breakpoint

-- No DELETE for either role. Succeeded, failed, and cancelled rows stay as the record of what
-- ran; removal arrives with the milestone 5 purge capability.
ALTER TABLE "handoff"."jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff"."jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The queue is global: reconcile and maintenance jobs have no workspace at all, and a claim
-- cannot filter by a tenant the worker has not resolved yet. The dispatcher therefore sees every
-- row, which is why it is a separate credential from the one serving mobile requests.
CREATE POLICY "jobs_dispatcher_access" ON "handoff"."jobs"
	FOR ALL TO handoff_dispatcher
	USING (true)
	WITH CHECK (true);
--> statement-breakpoint

-- The API's reach over the queue is its own tenant, and a job it enqueues must name that tenant:
-- a workspace-less maintenance job cannot be created through a mobile request.
CREATE POLICY "jobs_api_tenant_read" ON "handoff"."jobs"
	FOR SELECT TO handoff_api
	USING ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

CREATE POLICY "jobs_api_tenant_insert" ON "handoff"."jobs"
	FOR INSERT TO handoff_api
	WITH CHECK ("workspace_id" = nullif(current_setting('handoff.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Supabase's PostgREST roles must never reach the new tables either. Same guard as
-- 0001_access.sql, so the migration still runs on a plain Postgres instance.
DO $$
DECLARE
	provider_role text;
BEGIN
	FOREACH provider_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = provider_role) THEN
			EXECUTE 'REVOKE ALL ON "handoff"."media_assets" FROM ' || quote_ident(provider_role);
			EXECUTE 'REVOKE ALL ON "handoff"."jobs" FROM ' || quote_ident(provider_role);
		END IF;
	END LOOP;
END $$;
