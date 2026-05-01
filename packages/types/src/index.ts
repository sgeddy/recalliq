// Shared TypeScript interfaces for RecallIQ

export type {
  CertConfig,
  CertLevel,
  RenewalMethod,
  DodCategory,
  ExamDomain,
  PassingScore,
  RetakePolicy,
  RenewalConfig,
  RetentionPlanConfig,
  IntervalSchedules,
} from "./cert-config.js";

export { certConfigs, comptiaSecurityPlus, buildGenericCertConfig } from "./cert-configs/index.js";
export type { GenericCertConfigInputs } from "./cert-configs/index.js";

export type CourseStatus = "draft" | "published";
export type CourseDifficulty = "beginner" | "intermediate" | "advanced";
export type CardType = "flashcard" | "mcq" | "free_recall";
export type GoalType = "short_term" | "long_term" | "custom";
export type EnrollmentStatus = "active" | "paused" | "completed";
export type NotificationChannel = "email" | "sms" | "voice" | "push";
export type NotificationJobStatus = "pending" | "sent" | "failed";

export interface User {
  id: string;
  email: string;
  name: string | null;
  stripeCustomerId: string | null;
  createdAt: Date;
}

export interface Course {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  difficulty: CourseDifficulty;
  defaultIntervals: number[];
  passMark: number;
  status: CourseStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface Module {
  id: string;
  courseId: string;
  title: string;
  position: number;
  description: string | null;
  createdAt: Date;
}

export interface Card {
  id: string;
  moduleId: string;
  type: CardType;
  front: string;
  back: string;
  options: string[] | null;
  correctOptionIndex: number | null;
  correctOptionIndices: number[] | null;
  // Free-recall grading hints — key terms or phrases the answer should contain.
  acceptableAnswers: string[] | null;
  tags: string[];
  createdAt: Date;
}

export interface Enrollment {
  id: string;
  userId: string;
  courseId: string;
  goalType: GoalType;
  goalDate: Date | null;
  channels: NotificationChannel[];
  status: EnrollmentStatus;
  trialEndsAt: Date | null;
  stripeSubscriptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewEvent {
  id: string;
  enrollmentId: string;
  cardId: string;
  intervalIndex: number;
  scheduledAt: Date;
  completedAt: Date | null;
  passed: boolean | null;
  responseTime: number | null;
  channel: NotificationChannel | null;
  createdAt: Date;
}

export interface NotificationJob {
  id: string;
  enrollmentId: string;
  reviewEventId: string;
  channel: NotificationChannel;
  status: NotificationJobStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  externalId: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// AI-generated course payload (stored in uploads.generated_payload)
// ---------------------------------------------------------------------------

export interface GeneratedCard {
  type: CardType;
  front: string;
  back: string;
  options: string[] | null;
  correctOptionIndex: number | null;
  // Multi-select questions (e.g., "Select TWO"): array of correct indices
  correctOptionIndices: number[] | null;
  // Free-recall (short/long answer): list of key terms or phrases the user's
  // answer should contain. Server-side grading checks for keyword overlap.
  acceptableAnswers: string[] | null;
  tags: string[];
}

export interface GeneratedModule {
  title: string;
  description: string;
  position: number;
  cards: GeneratedCard[];
}

export interface GeneratedCourse {
  title: string;
  description: string;
  category: string;
  difficulty: CourseDifficulty;
  modules: GeneratedModule[];
}

// Upload types

export type UploadStatus = "pending" | "processing" | "review" | "confirmed" | "failed";
export type UploadSourceType = "file" | "url";

// SRS Engine types
export interface ReviewResult {
  enrollmentId: string;
  cardId: string;
  intervalIndex: number;
  passed: boolean;
}

export interface ScheduleOutput {
  nextScheduledAt: Date;
  nextIntervalIndex: number;
  completed: boolean;
}

// API response types
export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

export interface CourseWithStats extends Course {
  moduleCount: number;
  cardCount: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
