CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("role" IN ('user','admin','owner'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"display_prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_idx" ON "api_keys" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text REFERENCES "users"("id") ON DELETE set null,
	"anon_id" text,
	"api_key_id" text REFERENCES "api_keys"("id") ON DELETE set null,
	"source_url" text NOT NULL,
	"platform" text NOT NULL,
	"title" text,
	"duration_seconds" real,
	"media_type" text NOT NULL,
	"format" text NOT NULL,
	"quality" text NOT NULL,
	"options" jsonb NOT NULL,
	"status" text NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"output_ref" text,
	"output_filename" text,
	"output_size_bytes" bigint,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"hidden_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_user_created_idx" ON "jobs" ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_anon_created_idx" ON "jobs" ("anon_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_expires_idx" ON "jobs" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_request_idx" ON "jobs" ("request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"user_id" text,
	"api_key_id" text,
	"action" text NOT NULL,
	"ip_hash" text,
	"http_status" integer,
	"error_code" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_request_idx" ON "audit_logs" ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_action_created_idx" ON "audit_logs" ("action","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhooks" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"url" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
