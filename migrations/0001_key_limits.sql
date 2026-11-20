-- NULL rate_limit_per_minute = unlimited key (admin-set).
ALTER TABLE "api_keys" ALTER COLUMN "rate_limit_per_minute" DROP NOT NULL;
--> statement-breakpoint
-- Activity and audit history are no longer stored in the database (memory only). Remove old rows.
DELETE FROM "jobs";
--> statement-breakpoint
DELETE FROM "audit_logs";
