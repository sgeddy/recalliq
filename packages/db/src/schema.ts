import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const courseDifficultyEnum = pgEnum("course_difficulty", [
  "beginner",
  "intermediate",
  "advanced",
]);

export const courseStatusEnum = pgEnum("course_status", ["draft", "published"]);

export const cardTypeEnum = pgEnum("card_type", ["flashcard", "mcq", "free_recall"]);

export const goalTypeEnum = pgEnum("goal_type", ["short_term", "long_term", "custom"]);

export const enrollmentStatusEnum = pgEnum("enrollment_status", ["active", "paused", "completed"]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "sms",
  "voice",
  "push",
]);

export const notificationJobStatusEnum = pgEnum("notification_job_status", [
  "pending",
  "sent",
  "failed",
]);

export const examResultEnum = pgEnum("exam_result", ["pass", "fail"]);

export const mockExamStatusEnum = pgEnum("mock_exam_status", [
  "scheduled",
  "in_progress",
  "completed",
  "abandoned",
]);

export const uploadStatusEnum = pgEnum("upload_status", [
  "pending",
  "processing",
  "review",
  "confirmed",
  "failed",
]);

export const uploadSourceTypeEnum = pgEnum("upload_source_type", ["file", "url"]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // clerkId is the Clerk user sub (e.g. "user_2abc...") — used for upsert on auth
  clerkId: text("clerk_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  // E.164 phone number — required for voice and SMS channels
  phone: text("phone").unique(),
  // Stripe customer ID for billing — nullable until customer is created
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Owner of user-generated courses; null = platform-owned
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    difficulty: courseDifficultyEnum("difficulty").notNull(),
    // Interval sequence in days, e.g. [1, 4, 10, 30, 90]
    defaultIntervals: integer("default_intervals").array().notNull(),
    // Pass mark as integer percentage (0–100)
    passMark: integer("pass_mark").notNull().default(75),
    status: courseStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("courses_status_idx").on(t.status),
    categoryIdx: index("courses_category_idx").on(t.category),
    userIdx: index("courses_user_id_idx").on(t.userId),
  }),
);

export const modules = pgTable(
  "modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    courseIdx: index("modules_course_id_idx").on(t.courseId),
    positionIdx: index("modules_course_position_idx").on(t.courseId, t.position),
  }),
);

export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    type: cardTypeEnum("type").notNull(),
    front: text("front").notNull(),
    back: text("back").notNull(),
    // MCQ answer options stored as JSON array of strings
    options: jsonb("options").$type<string[]>(),
    // Zero-based index of the correct option for MCQ cards; null for flashcard/free_recall
    correctOptionIndex: integer("correct_option_index"),
    // For "Select TWO" questions: array of correct option indices. Takes precedence over correctOptionIndex.
    correctOptionIndices: jsonb("correct_option_indices").$type<number[]>(),
    tags: text("tags")
      .array()
      .notNull()
      .$defaultFn(() => []),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    moduleIdx: index("cards_module_id_idx").on(t.moduleId),
    typeIdx: index("cards_type_idx").on(t.type),
  }),
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    goalType: goalTypeEnum("goal_type").notNull().default("long_term"),
    goalDate: timestamp("goal_date", { withTimezone: true }),
    channels: notificationChannelEnum("channels")
      .array()
      .notNull()
      .$defaultFn(() => ["email"] as const),
    status: enrollmentStatusEnum("status").notNull().default("active"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    // Stripe subscription ID — prices stored in Stripe, amounts always in cents
    stripeSubscriptionId: text("stripe_subscription_id"),
    // Scheduled exam date — used to trigger the day-after follow-up job.
    examDate: timestamp("exam_date", { withTimezone: true }),
    // Recorded after the exam follow-up: did the user pass or fail?
    examResult: examResultEnum("exam_result"),
    // Actual scaled score the user received (optional — not all users provide it).
    examScore: integer("exam_score"),
    // Study plan settings persisted from the StudyPlanCalculator.
    sessionConfig: jsonb("session_config").$type<{
      dailyStudyMinutes: number;
      weeksUntilExam: number;
      chronotype: string;
      priorKnowledge: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("enrollments_user_id_idx").on(t.userId),
    courseIdx: index("enrollments_course_id_idx").on(t.courseId),
    userCourseIdx: index("enrollments_user_course_idx").on(t.userId, t.courseId),
    statusIdx: index("enrollments_status_idx").on(t.status),
  }),
);

export const reviewEvents = pgTable(
  "review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    intervalIndex: integer("interval_index").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    passed: boolean("passed"),
    // Response time in milliseconds
    responseTime: integer("response_time"),
    channel: notificationChannelEnum("channel"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enrollmentIdx: index("review_events_enrollment_id_idx").on(t.enrollmentId),
    cardIdx: index("review_events_card_id_idx").on(t.cardId),
    scheduledAtIdx: index("review_events_scheduled_at_idx").on(t.scheduledAt),
    // Composite index for the most common query: upcoming reviews for an enrollment
    enrollmentScheduledIdx: index("review_events_enrollment_scheduled_idx").on(
      t.enrollmentId,
      t.scheduledAt,
    ),
  }),
);

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "cascade" }),
    reviewEventId: uuid("review_event_id")
      .notNull()
      .references(() => reviewEvents.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationJobStatusEnum("status").notNull().default("pending"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // External delivery ID from Resend/Twilio for status tracking
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enrollmentIdx: index("notification_jobs_enrollment_id_idx").on(t.enrollmentId),
    reviewEventIdx: index("notification_jobs_review_event_id_idx").on(t.reviewEventId),
    statusIdx: index("notification_jobs_status_idx").on(t.status),
    scheduledAtIdx: index("notification_jobs_scheduled_at_idx").on(t.scheduledAt),
  }),
);

export const mockExamSessions = pgTable(
  "mock_exam_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrollmentId: uuid("enrollment_id")
      .notNull()
      .references(() => enrollments.id, { onDelete: "cascade" }),
    status: mockExamStatusEnum("status").notNull().default("scheduled"),
    // When the user wants to sit the exam (may be null for immediate start).
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Seconds the user actually spent — can differ from 90 min if they finish early.
    durationSeconds: integer("duration_seconds"),
    questionCount: integer("question_count").notNull().default(85),
    correctCount: integer("correct_count"),
    // Scaled 100–900. CompTIA passing = 750.
    scaledScore: integer("scaled_score"),
    passed: boolean("passed"),
    // Per-domain breakdown: { "Security Operations": { correct: 20, total: 24 } }
    domainBreakdown:
      jsonb("domain_breakdown").$type<Record<string, { correct: number; total: number }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enrollmentIdx: index("mock_exam_sessions_enrollment_id_idx").on(t.enrollmentId),
    statusIdx: index("mock_exam_sessions_status_idx").on(t.status),
    scheduledForIdx: index("mock_exam_sessions_scheduled_for_idx").on(t.scheduledFor),
  }),
);

export const mockExamAnswers = pgTable(
  "mock_exam_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => mockExamSessions.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    // null = skipped / timed out
    selectedOptionIndex: integer("selected_option_index"),
    isCorrect: boolean("is_correct"),
    responseTimeMs: integer("response_time_ms"),
    // Denormalised for fast domain-breakdown queries without joining cards→modules
    domainName: text("domain_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index("mock_exam_answers_session_id_idx").on(t.sessionId),
    cardIdx: index("mock_exam_answers_card_id_idx").on(t.cardId),
  }),
);

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    status: uploadStatusEnum("status").notNull().default("pending"),
    // AI-generated course structure stored for user review before confirming
    generatedPayload: jsonb("generated_payload"),
    // Set after user confirms and course is persisted
    courseId: uuid("course_id").references(() => courses.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("uploads_user_id_idx").on(t.userId),
    statusIdx: index("uploads_status_idx").on(t.status),
  }),
);

export const uploadSources = pgTable(
  "upload_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    sourceType: uploadSourceTypeEnum("source_type").notNull(),
    // Original filename or URL
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    // Extracted text content from the file or URL
    content: text("content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uploadIdx: index("upload_sources_upload_id_idx").on(t.uploadId),
  }),
);

// ---------------------------------------------------------------------------
// Schema type exports for use with Drizzle's InferSelectModel / InferInsertModel
// ---------------------------------------------------------------------------

export type DbUser = typeof users.$inferSelect;
export type NewDbUser = typeof users.$inferInsert;

export type DbCourse = typeof courses.$inferSelect;
export type NewDbCourse = typeof courses.$inferInsert;

export type DbModule = typeof modules.$inferSelect;
export type NewDbModule = typeof modules.$inferInsert;

export type DbCard = typeof cards.$inferSelect;
export type NewDbCard = typeof cards.$inferInsert;

export type DbEnrollment = typeof enrollments.$inferSelect;
export type NewDbEnrollment = typeof enrollments.$inferInsert;

export type DbReviewEvent = typeof reviewEvents.$inferSelect;
export type NewDbReviewEvent = typeof reviewEvents.$inferInsert;

export type DbNotificationJob = typeof notificationJobs.$inferSelect;
export type NewDbNotificationJob = typeof notificationJobs.$inferInsert;

export type DbMockExamSession = typeof mockExamSessions.$inferSelect;
export type NewDbMockExamSession = typeof mockExamSessions.$inferInsert;

export type DbMockExamAnswer = typeof mockExamAnswers.$inferSelect;
export type NewDbMockExamAnswer = typeof mockExamAnswers.$inferInsert;

export type DbUpload = typeof uploads.$inferSelect;
export type NewDbUpload = typeof uploads.$inferInsert;

export type DbUploadSource = typeof uploadSources.$inferSelect;
export type NewDbUploadSource = typeof uploadSources.$inferInsert;
