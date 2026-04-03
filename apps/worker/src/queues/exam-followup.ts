import type { ConnectionOptions, DefaultJobOptions } from "bullmq";
import { Queue } from "bullmq";

export const EXAM_FOLLOWUP_QUEUE = "exam-followup";

// Discriminated union so a single queue handles both job types.
export type ExamFollowUpJobData =
  | {
      type: "exam-followup";
      enrollmentId: string;
      // ISO string of the actual exam date — displayed in email copy.
      examDate: string;
    }
  | {
      type: "maintenance";
      enrollmentId: string;
      intervalLabel: string; // e.g. "1 month", "3 months"
      questionCount: number;
      sessionMinutes: number;
    };

const MAX_RETRIES = 3;

export const examFollowUpJobOptions: DefaultJobOptions = {
  attempts: MAX_RETRIES,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function createExamFollowUpQueue(connection: ConnectionOptions): Queue<ExamFollowUpJobData> {
  return new Queue<ExamFollowUpJobData>(EXAM_FOLLOWUP_QUEUE, {
    connection,
    defaultJobOptions: examFollowUpJobOptions,
  });
}
