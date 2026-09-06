CREATE SCHEMA "handoff";
--> statement-breakpoint
CREATE TYPE "handoff"."app_role" AS ENUM('owner', 'staff', 'caregiver', 'guardian');
--> statement-breakpoint
CREATE TYPE "handoff"."caregiver_relationship" AS ENUM('parent', 'relative', 'caregiver', 'other');
--> statement-breakpoint
CREATE TYPE "handoff"."child_permission" AS ENUM('reader', 'contributor', 'manager');
--> statement-breakpoint
CREATE TYPE "handoff"."child_status" AS ENUM('active', 'archived', 'deleting', 'deleted');
--> statement-breakpoint
CREATE TYPE "handoff"."data_key_purpose" AS ENUM('content', 'lookup');
--> statement-breakpoint
CREATE TYPE "handoff"."data_key_state" AS ENUM('active', 'decrypt_only', 'retired');
--> statement-breakpoint
CREATE TYPE "handoff"."encryption_scope_kind" AS ENUM('workspace', 'user');
--> statement-breakpoint
CREATE TYPE "handoff"."invitation_status" AS ENUM('pending_send', 'sent', 'accepted', 'revoked', 'expired', 'reconcile_needed');
--> statement-breakpoint
CREATE TYPE "handoff"."membership_status" AS ENUM('active', 'revoked');
--> statement-breakpoint
CREATE TYPE "handoff"."user_status" AS ENUM('active', 'deleted');
--> statement-breakpoint
CREATE TYPE "handoff"."webhook_status" AS ENUM('received', 'processed', 'failed');
--> statement-breakpoint
CREATE TYPE "handoff"."workspace_kind" AS ENUM('household', 'daycare');
--> statement-breakpoint
CREATE TYPE "handoff"."workspace_status" AS ENUM('active', 'deleting', 'deleted');
--> statement-breakpoint
CREATE TABLE "handoff"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"profile_ciphertext" jsonb NOT NULL,
	"status" "handoff"."user_status" DEFAULT 'active' NOT NULL,
	"processing_notice_version" text,
	"processing_notice_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"kind" "handoff"."workspace_kind" NOT NULL,
	"profile_ciphertext" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"status" "handoff"."workspace_status" DEFAULT 'active' NOT NULL,
	"storage_budget_bytes" bigint NOT NULL,
	"storage_reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "workspaces_clerk_org_id_unique" UNIQUE("clerk_org_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."workspace_memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"clerk_membership_id" text NOT NULL,
	"app_role" "handoff"."app_role" NOT NULL,
	"status" "handoff"."membership_status" DEFAULT 'active' NOT NULL,
	"provider_verified_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_memberships_clerk_membership_id_unique" UNIQUE("clerk_membership_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."data_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"purpose" "handoff"."data_key_purpose" NOT NULL,
	"version" integer NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"wrapping_provider" text NOT NULL,
	"wrapping_key_ref" text NOT NULL,
	"wrapping_context_version" integer NOT NULL,
	"state" "handoff"."data_key_state" DEFAULT 'active' NOT NULL,
	"reserved_encryptions" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_keys_single_scope_check" CHECK (("handoff"."data_keys"."workspace_id" IS NULL) <> ("handoff"."data_keys"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "handoff"."children" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_ciphertext" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"journal_seq" bigint DEFAULT 0 NOT NULL,
	"status" "handoff"."child_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff"."child_caregivers" (
	"workspace_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"relationship" "handoff"."caregiver_relationship" NOT NULL,
	"permission" "handoff"."child_permission" NOT NULL,
	"status" "handoff"."membership_status" DEFAULT 'active' NOT NULL,
	"granted_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "child_caregivers_workspace_id_child_id_user_id_pk" PRIMARY KEY("workspace_id","child_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."invitation_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"clerk_invitation_id" text,
	"invitee_ciphertext" jsonb NOT NULL,
	"email_lookup_hash" "bytea" NOT NULL,
	"email_lookup_key_id" uuid NOT NULL,
	"intended_app_role" "handoff"."app_role" NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"status" "handoff"."invitation_status" DEFAULT 'pending_send' NOT NULL,
	"accepted_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invitation_intents_clerk_invitation_id_unique" UNIQUE("clerk_invitation_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."invitation_child_grants" (
	"workspace_id" uuid NOT NULL,
	"invitation_intent_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"relationship" "handoff"."caregiver_relationship" NOT NULL,
	"permission" "handoff"."child_permission" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_child_grants_invitation_intent_id_child_id_pk" PRIMARY KEY("invitation_intent_id","child_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."idempotency_requests" (
	"actor_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" uuid NOT NULL,
	"scope_kind" "handoff"."encryption_scope_kind" NOT NULL,
	"scope_workspace_id" uuid,
	"request_fingerprint" "bytea" NOT NULL,
	"fingerprint_key_id" uuid NOT NULL,
	"response_status" integer NOT NULL,
	"response_ciphertext" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_requests_actor_user_id_operation_key_pk" PRIMARY KEY("actor_user_id","operation","key"),
	CONSTRAINT "idempotency_requests_scope_check" CHECK (("handoff"."idempotency_requests"."scope_kind" = 'workspace') = ("handoff"."idempotency_requests"."scope_workspace_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "handoff"."webhook_inbox" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"clerk_org_id" text,
	"clerk_user_id" text,
	"clerk_membership_id" text,
	"clerk_invitation_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "handoff"."webhook_status" DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "webhook_inbox_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "handoff"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"child_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "child_caregivers_user_status_child_idx" ON "handoff"."child_caregivers" USING btree ("workspace_id","user_id","status","child_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "children_workspace_id_id_key" ON "handoff"."children" USING btree ("workspace_id","id");
--> statement-breakpoint
CREATE INDEX "children_workspace_status_idx" ON "handoff"."children" USING btree ("workspace_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "data_keys_active_workspace_purpose_idx" ON "handoff"."data_keys" USING btree ("workspace_id","purpose") WHERE "handoff"."data_keys"."state" = 'active' AND "handoff"."data_keys"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_keys_active_user_purpose_idx" ON "handoff"."data_keys" USING btree ("user_id","purpose") WHERE "handoff"."data_keys"."state" = 'active' AND "handoff"."data_keys"."user_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_keys_workspace_purpose_version_idx" ON "handoff"."data_keys" USING btree ("workspace_id","purpose","version") WHERE "handoff"."data_keys"."workspace_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_keys_user_purpose_version_idx" ON "handoff"."data_keys" USING btree ("user_id","purpose","version") WHERE "handoff"."data_keys"."user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_status_idx" ON "handoff"."workspace_memberships" USING btree ("user_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_intents_workspace_id_id_key" ON "handoff"."invitation_intents" USING btree ("workspace_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_intents_open_lookup_idx" ON "handoff"."invitation_intents" USING btree ("workspace_id","email_lookup_hash") WHERE "handoff"."invitation_intents"."status" IN ('pending_send', 'sent', 'reconcile_needed');
--> statement-breakpoint
ALTER TABLE "handoff"."child_caregivers" ADD CONSTRAINT "child_caregivers_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."child_caregivers" ADD CONSTRAINT "child_caregivers_child_fk" FOREIGN KEY ("workspace_id","child_id") REFERENCES "handoff"."children"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."child_caregivers" ADD CONSTRAINT "child_caregivers_membership_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "handoff"."workspace_memberships"("workspace_id","user_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."children" ADD CONSTRAINT "children_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."children" ADD CONSTRAINT "children_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."data_keys" ADD CONSTRAINT "data_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."data_keys" ADD CONSTRAINT "data_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."idempotency_requests" ADD CONSTRAINT "idempotency_requests_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."idempotency_requests" ADD CONSTRAINT "idempotency_requests_scope_workspace_id_workspaces_id_fk" FOREIGN KEY ("scope_workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."idempotency_requests" ADD CONSTRAINT "idempotency_requests_fingerprint_key_id_data_keys_id_fk" FOREIGN KEY ("fingerprint_key_id") REFERENCES "handoff"."data_keys"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."invitation_child_grants" ADD CONSTRAINT "invitation_child_grants_intent_fk" FOREIGN KEY ("workspace_id","invitation_intent_id") REFERENCES "handoff"."invitation_intents"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."invitation_child_grants" ADD CONSTRAINT "invitation_child_grants_child_fk" FOREIGN KEY ("workspace_id","child_id") REFERENCES "handoff"."children"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."invitation_intents" ADD CONSTRAINT "invitation_intents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "handoff"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."invitation_intents" ADD CONSTRAINT "invitation_intents_email_lookup_key_id_data_keys_id_fk" FOREIGN KEY ("email_lookup_key_id") REFERENCES "handoff"."data_keys"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."invitation_intents" ADD CONSTRAINT "invitation_intents_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff"."invitation_intents" ADD CONSTRAINT "invitation_intents_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "handoff"."users"("id") ON DELETE no action ON UPDATE no action;
