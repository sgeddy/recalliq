import { Queue } from "bullmq";
import { Redis } from "ioredis";

// NOTE: Singleton Redis connection and BullMQ queue instances for the API process.
// These queues are used only to enqueue jobs — actual delivery (Resend/Twilio) is
// handled exclusively by apps/worker.

export const REVIEW_NOTIFICATION_QUEUE = "review-notifications";
export const EXAM_FOLLOWUP_QUEUE = "exam-followup";
export const CONTENT_PROCESSING_QUEUE = "content-processing";

const MAX_RETRIES = 3;

export interface ReviewNotificationJobData {
  enrollmentId: string;
  channel: "email" | "sms" | "voice" | "push";
  scheduledAt: string;
}

export type ExamFollowUpJobData =
  | {
      type: "exam-followup";
      enrollmentId: string;
      examDate: string;
    }
  | {
      type: "maintenance";
      enrollmentId: string;
      intervalLabel: string;
      questionCount: number;
      sessionMinutes: number;
    };

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";

const defaultJobOptions = {
  attempts: MAX_RETRIES,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const reviewNotificationQueue = new Queue<ReviewNotificationJobData>(
  REVIEW_NOTIFICATION_QUEUE,
  { connection: redis, defaultJobOptions },
);

export const examFollowUpQueue = new Queue<ExamFollowUpJobData>(EXAM_FOLLOWUP_QUEUE, {
  connection: redis,
  defaultJobOptions,
});

export interface ContentProcessingJobData {
  uploadId: string;
}

export const contentProcessingQueue = new Queue<ContentProcessingJobData>(
  CONTENT_PROCESSING_QUEUE,
  { connection: redis, defaultJobOptions },
);
