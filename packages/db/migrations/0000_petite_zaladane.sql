DO $$ BEGIN
 CREATE TYPE "public"."card_type" AS ENUM('flashcard', 'mcq', 'free_recall');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."course_difficulty" AS ENUM('beginner', 'intermediate', 'advanced');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."course_status" AS ENUM('draft', 'published');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'paused', 'completed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."goal_type" AS ENUM('short_term', 'long_term', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms', 'voice', 'push');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."notification_job_status" AS ENUM('pending', 'sent', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid NOT NULL,
	"type" "card_type" NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"options" jsonb,
	"tags" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"difficulty" "course_difficulty" NOT NULL,
	"default_intervals" integer[] NOT NULL,
	"pass_mark" integer DEFAULT 75 NOT NULL,
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"goal_type" "goal_type" DEFAULT 'long_term' NOT NULL,
	"goal_date" timestamp with time zone,
	"channels" notification_channel[] NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"review_event_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "notification_job_status" DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"interval_index" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"passed" boolean,
	"response_time" integer,
	"channel" "notification_channel",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cards" ADD CONSTRAINT "cards_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_review_event_id_review_events_id_fk" FOREIGN KEY ("review_event_id") REFERENCES "public"."review_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_events" ADD CONSTRAINT "review_events_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_events" ADD CONSTRAINT "review_events_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_module_id_idx" ON "cards" ("module_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_type_idx" ON "cards" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courses_status_idx" ON "courses" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "courses_category_idx" ON "courses" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_user_id_idx" ON "enrollments" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_course_id_idx" ON "enrollments" ("course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_user_course_idx" ON "enrollments" ("user_id","course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "enrollments_status_idx" ON "enrollments" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "modules_course_id_idx" ON "modules" ("course_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "modules_course_position_idx" ON "modules" ("course_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_jobs_enrollment_id_idx" ON "notification_jobs" ("enrollment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_jobs_review_event_id_idx" ON "notification_jobs" ("review_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_jobs_status_idx" ON "notification_jobs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_jobs_scheduled_at_idx" ON "notification_jobs" ("scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_events_enrollment_id_idx" ON "review_events" ("enrollment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_events_card_id_idx" ON "review_events" ("card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_events_scheduled_at_idx" ON "review_events" ("scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_events_enrollment_scheduled_idx" ON "review_events" ("enrollment_id","scheduled_at");