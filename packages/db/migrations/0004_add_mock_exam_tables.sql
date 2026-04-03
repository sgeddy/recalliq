-- Mock exam sessions: one row per timed practice exam attempt.
-- Mock exam answers: one row per question answered within a session.
-- These are separate from the SRS review_events flow — mock exams are
-- diagnostic assessments, not interval-scheduled reviews.

CREATE TYPE "public"."mock_exam_status" AS ENUM('scheduled', 'in_progress', 'completed', 'abandoned');

CREATE TABLE "mock_exam_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enrollment_id" uuid NOT NULL REFERENCES "enrollments"("id") ON DELETE CASCADE,
  "status" "mock_exam_status" NOT NULL DEFAULT 'scheduled',
  "scheduled_for" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "duration_seconds" integer,
  "question_count" integer NOT NULL DEFAULT 85,
  "correct_count" integer,
  "scaled_score" integer,
  "passed" boolean,
  "domain_breakdown" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE "mock_exam_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "mock_exam_sessions"("id") ON DELETE CASCADE,
  "card_id" uuid NOT NULL REFERENCES "cards"("id") ON DELETE CASCADE,
  "selected_option_index" integer,
  "is_correct" boolean,
  "response_time_ms" integer,
  "domain_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "mock_exam_sessions_enrollment_id_idx" ON "mock_exam_sessions"("enrollment_id");
CREATE INDEX "mock_exam_sessions_status_idx" ON "mock_exam_sessions"("status");
CREATE INDEX "mock_exam_sessions_scheduled_for_idx" ON "mock_exam_sessions"("scheduled_for");
CREATE INDEX "mock_exam_answers_session_id_idx" ON "mock_exam_answers"("session_id");
CREATE INDEX "mock_exam_answers_card_id_idx" ON "mock_exam_answers"("card_id");

-- rollback
-- DROP INDEX "mock_exam_answers_card_id_idx";
-- DROP INDEX "mock_exam_answers_session_id_idx";
-- DROP INDEX "mock_exam_sessions_scheduled_for_idx";
-- DROP INDEX "mock_exam_sessions_status_idx";
-- DROP INDEX "mock_exam_sessions_enrollment_id_idx";
-- DROP TABLE "mock_exam_answers";
-- DROP TABLE "mock_exam_sessions";
-- DROP TYPE "public"."mock_exam_status";
