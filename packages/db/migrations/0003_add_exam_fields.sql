-- Add exam tracking fields to enrollments.
-- exam_date: when the real exam is scheduled — used to fire the day-after follow-up job.
-- exam_result: recorded after the follow-up; drives pass (→ maintenance) / fail (→ restart) branching.
-- exam_score: optional scaled score the user received.

CREATE TYPE "public"."exam_result" AS ENUM('pass', 'fail');

ALTER TABLE "enrollments" ADD COLUMN "exam_date" timestamp with time zone;
ALTER TABLE "enrollments" ADD COLUMN "exam_result" "exam_result";
ALTER TABLE "enrollments" ADD COLUMN "exam_score" integer;

-- rollback
-- ALTER TABLE "enrollments" DROP COLUMN "exam_score";
-- ALTER TABLE "enrollments" DROP COLUMN "exam_result";
-- ALTER TABLE "enrollments" DROP COLUMN "exam_date";
-- DROP TYPE "public"."exam_result";
