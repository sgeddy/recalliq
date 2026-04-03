import type { ConnectionOptions, DefaultJobOptions } from "bullmq";
import { Queue } from "bullmq";

export const VOICE_CALL_QUEUE = "voice-calls";

export interface VoiceCallJobData {
  enrollmentId: string;
  // E.164 phone number from the user record
  phoneNumber: string;
  // ISO timestamp of when the call should be placed (for delayed scheduling)
  scheduledAt: string;
}

const MAX_RETRIES = 3;

export const voiceCallJobOptions: DefaultJobOptions = {
  attempts: MAX_RETRIES,
  backoff: { type: "exponential", delay: 10000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 2000 },
};

export function createVoiceCallQueue(connection: ConnectionOptions): Queue<VoiceCallJobData> {
  return new Queue<VoiceCallJobData>(VOICE_CALL_QUEUE, {
    connection,
    defaultJobOptions: voiceCallJobOptions,
  });
}
