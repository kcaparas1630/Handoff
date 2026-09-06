CREATE TYPE "handoff"."job_kind" AS ENUM('process_capture', 'validate_media', 'reconcile_clerk', 'cleanup_audio', 'purge_child', 'purge_workspace');
--> statement-breakpoint
CREATE TYPE "handoff"."job_status" AS ENUM('queued', 'leased', 'succeeded', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "handoff"."media_cleanup_state" AS ENUM('none', 'object_deleted', 'quota_released');
--> statement-breakpoint
CREATE TYPE "handoff"."media_kind" AS ENUM('audio', 'image', 'video');
--> statement-breakpoint
CREATE TYPE "handoff"."media_status" AS ENUM('pending_upload', 'uploaded', 'ready', 'rejected', 'deleting', 'deleted');
--> statement-breakpoint
CREATE TABLE "handoff"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "handoff"."job_kind" NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "handoff"."job_status" DEFAULT 'queued' NOT NULL,
	"workspace_id" uuid,
	"child_id" uuid,
	"capture_id" uuid,
	"asset_id" uuid,
	"payload" jsonb NOT NULL,
	"checkpoint" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"kind" "handoff"."media_kind" NOT NULL,
	"storage_provider" text NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"declared_mime" text NOT NULL,
	"verified_mime" text,
	"reserved_bytes" bigint NOT NULL,
	"size_bytes" bigint,
	"duration_ms" integer,
	"checksum" text,
	"status" "handoff"."media_status" DEFAULT 'pending_upload' NOT NULL,
	"cleanup_state" "handoff"."media_cleanup_state" DEFAULT 'none' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "handoff"."jobs" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "jobs_status_available_idx" ON "handoff"."jobs" USING btree ("status","available_at");
--> statement-breakpoint
CREATE INDEX "jobs_status_lease_expires_idx" ON "handoff"."jobs" USING btree ("status","lease_expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_object_key" ON "handoff"."media_assets" USING btree ("storage_provider","bucket","object_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_workspace_child_id_key" ON "handoff"."media_assets" USING btree ("workspace_id","child_id","id");
--> statement-breakpoint
CREATE INDEX "media_assets_status_expires_idx" ON "handoff"."media_assets" USING btree ("status","expires_at");
--> statement-breakpoint
ALTER TABLE "handoff"."jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."jobs" ADD CONSTRAINT "jobs_child_fk" FOREIGN KEY ("workspace_id","child_id") REFERENCES "handoff"."children"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."jobs" ADD CONSTRAINT "jobs_capture_fk" FOREIGN KEY ("workspace_id","child_id","capture_id") REFERENCES "handoff"."captures"("workspace_id","child_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."jobs" ADD CONSTRAINT "jobs_asset_fk" FOREIGN KEY ("workspace_id","child_id","asset_id") REFERENCES "handoff"."media_assets"("workspace_id","child_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."media_assets" ADD CONSTRAINT "media_assets_capture_fk" FOREIGN KEY ("workspace_id","child_id","capture_id") REFERENCES "handoff"."captures"("workspace_id","child_id","id") ON DELETE no action ON UPDATE no action;
