import type { ConnectionOptions, DefaultJobOptions } from "bullmq";
import { Queue } from "bullmq";

export const REVIEW_NOTIFICATION_QUEUE = "review-notifications";

export interface ReviewNotificationJobData {
  enrollmentId: string;
  channel: "email" | "sms" | "voice" | "push";
  // ISO string for the session day (start-of-day UTC). Used to fetch all
  // pending notification_jobs due for this session in one query.
  scheduledAt: string;
}

const MAX_RETRIES = 3;

// NOTE: All notification dispatch goes through BullMQ — never from API request handlers.
// Retry config: max 3 attempts with exponential backoff, then mark as failed.
export const defaultJobOptions: DefaultJobOptions = {
  attempts: MAX_RETRIES,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function createReviewNotificationQueue(
  connection: ConnectionOptions,
): Queue<ReviewNotificationJobData> {
  return new Queue<ReviewNotificationJobData>(REVIEW_NOTIFICATION_QUEUE, {
    connection,
    defaultJobOptions,
  });
}
