-- Add E.164 phone number to users for voice and SMS channels.

ALTER TABLE "users" ADD COLUMN "phone" text UNIQUE;

-- rollback
-- ALTER TABLE "users" DROP COLUMN "phone";
