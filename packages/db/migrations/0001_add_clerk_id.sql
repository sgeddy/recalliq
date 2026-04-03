ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerk_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_id_idx" ON "users" ("clerk_id");
