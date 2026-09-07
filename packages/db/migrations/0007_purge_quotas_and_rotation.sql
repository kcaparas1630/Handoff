-- Milestone 5 schema: the rotation job kind, the per-workspace/day provider spend counters the
-- extraction budget reads, and the instant a workspace deletion was requested, which is what the
-- scope-key retention window is measured from.
ALTER TYPE "handoff"."job_kind" ADD VALUE 'rotate_data_keys';--> statement-breakpoint
CREATE TABLE "handoff"."provider_usage" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	"audio_seconds" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_usage_workspace_id_day_pk" PRIMARY KEY("workspace_id","day")
);
--> statement-breakpoint
ALTER TABLE "handoff"."workspaces" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "handoff"."provider_usage" ADD CONSTRAINT "provider_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;