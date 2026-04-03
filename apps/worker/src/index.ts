import { Worker } from "bullmq";
import { Redis } from "ioredis";
import twilio from "twilio";

import {
  renderExamFollowUpEmail,
  renderMaintenanceReminderEmail,
  renderSessionEmail,
  sendEmail,
  sendSms,
} from "@recalliq/notifications";
import {
  and,
  courses,
  db,
  enrollments,
  eq,
  lte,
  notificationJobs,
  reviewEvents,
  users,
} from "@recalliq/db";

import {
  REVIEW_NOTIFICATION_QUEUE,
  type ReviewNotificationJobData,
} from "./queues/review-notifications.js";
import { EXAM_FOLLOWUP_QUEUE, type ExamFollowUpJobData } from "./queues/exam-followup.js";
import { VOICE_CALL_QUEUE, type VoiceCallJobData } from "./queues/voice-call.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const BASE_URL = process.env["WEB_BASE_URL"] ?? "http://localhost:3000";

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// NOTE: All notification logic lives in this worker.
// Twilio and Resend are never called from apps/api.
const worker = new Worker<ReviewNotificationJobData>(
  REVIEW_NOTIFICATION_QUEUE,
  async (job) => {
    const { enrollmentId, channel } = job.data;

    job.log(`Processing ${channel} session for enrollment ${enrollmentId}`);

    switch (channel) {
      case "email": {
        await handleEmailNotification({ enrollmentId });
        break;
      }

      case "sms": {
        // TODO(team): Fetch user phone number from DB and send SMS (#20)
        await sendSms({
          to: "+10000000000",
          body: "Time for your RecallIQ review session!",
        });
        break;
      }

      case "voice": {
        await handleVoiceNotification({ enrollmentId });
        break;
      }

      case "push": {
        // TODO(team): Implement push channel (#21)
        job.log(`Channel ${channel} not yet implemented`);
        break;
      }

      default: {
        const exhaustiveCheck: never = channel;
        throw new Error(`Unknown channel: ${String(exhaustiveCheck)}`);
      }
    }
  },
  {
    connection: redis,
    concurrency: 5,
    // Stay within Resend's 5 req/s rate limit
    limiter: {
      max: 5,
      duration: 1000,
    },
  },
);

async function handleEmailNotification(params: { enrollmentId: string }): Promise<void> {
  const { enrollmentId } = params;

  // Fetch all pending email notification_jobs for this enrollment that are due now.
  // Using scheduledAt <= now bundles every card from the same session into one email,
  // even if individual cards were scheduled fractions of a second apart.
  const sessionItems = await db
    .select({
      jobId: notificationJobs.id,
      reviewIntervalIndex: reviewEvents.intervalIndex,
    })
    .from(notificationJobs)
    .innerJoin(reviewEvents, eq(reviewEvents.id, notificationJobs.reviewEventId))
    .where(
      and(
        eq(notificationJobs.enrollmentId, enrollmentId),
        eq(notificationJobs.channel, "email"),
        eq(notificationJobs.status, "pending"),
        lte(notificationJobs.scheduledAt, new Date()),
      ),
    );

  if (sessionItems.length === 0) {
    // Already processed by a concurrent worker run — safe to skip.
    return;
  }

  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId))
    .limit(1);

  if (!enrollment) throw new Error(`Enrollment not found: ${enrollmentId}`);

  const [user] = await db.select().from(users).where(eq(users.id, enrollment.userId)).limit(1);

  if (!user) throw new Error(`User not found: ${enrollment.userId}`);

  const [course] = await db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, enrollment.courseId))
    .limit(1);

  const courseTitle = course?.title ?? "Your RecallIQ Course";
  const isInitialSession = sessionItems.every((item) => item.reviewIntervalIndex === 0);

  const html = renderSessionEmail({
    ...(user.name ? { recipientName: user.name } : {}),
    courseTitle,
    enrollmentId,
    cardCount: sessionItems.length,
    baseUrl: BASE_URL,
    isInitialSession,
  });

  const subject = isInitialSession
    ? "Your first RecallIQ lesson is ready!"
    : "Time to review your RecallIQ cards!";

  try {
    const result = await sendEmail({ to: user.email, subject, html });

    await db
      .update(notificationJobs)
      .set({ status: "sent", sentAt: new Date(), externalId: result.id })
      .where(
        and(
          eq(notificationJobs.enrollmentId, enrollmentId),
          eq(notificationJobs.channel, "email"),
          eq(notificationJobs.status, "pending"),
          lte(notificationJobs.scheduledAt, new Date()),
        ),
      );
  } catch (err) {
    await db
      .update(notificationJobs)
      .set({ status: "failed" })
      .where(
        and(
          eq(notificationJobs.enrollmentId, enrollmentId),
          eq(notificationJobs.channel, "email"),
          eq(notificationJobs.status, "pending"),
          lte(notificationJobs.scheduledAt, new Date()),
        ),
      );
    throw err;
  }
}

async function handleVoiceNotification(params: { enrollmentId: string }): Promise<void> {
  const { enrollmentId } = params;

  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId))
    .limit(1);

  if (!enrollment) throw new Error(`Enrollment not found: ${enrollmentId}`);

  const [user] = await db.select().from(users).where(eq(users.id, enrollment.userId)).limit(1);

  if (!user?.phone) {
    console.warn(`Skipping voice call for enrollment ${enrollmentId}: no phone number on file`);
    return;
  }

  const client = twilio(
    process.env["TWILIO_ACCOUNT_SID"] ?? "",
    process.env["TWILIO_AUTH_TOKEN"] ?? "",
  );

  const call = await client.calls.create({
    to: user.phone,
    from: process.env["TWILIO_PHONE_NUMBER"] ?? "",
    url: `${process.env["API_BASE_URL"] ?? "http://localhost:3001"}/twiml/review-call?enrollmentId=${enrollmentId}`,
    statusCallback: `${process.env["API_BASE_URL"] ?? "http://localhost:3001"}/webhooks/call-status`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["completed", "failed", "no-answer"],
  });

  console.info(`Outbound call initiated: callSid=${call.sid} enrollment=${enrollmentId}`);
}

worker.on("completed", (job) => {
  console.info(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

worker.on("error", (err) => {
  console.error("Worker error:", err);
});

// ---------------------------------------------------------------------------
// Exam follow-up worker
// ---------------------------------------------------------------------------

const examFollowUpWorker = new Worker<ExamFollowUpJobData>(
  EXAM_FOLLOWUP_QUEUE,
  async (job) => {
    const data = job.data;

    job.log(`Processing exam follow-up job type=${data.type} enrollment=${data.enrollmentId}`);

    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, data.enrollmentId))
      .limit(1);

    if (!enrollment) throw new Error(`Enrollment not found: ${data.enrollmentId}`);

    const [user] = await db.select().from(users).where(eq(users.id, enrollment.userId)).limit(1);

    if (!user) throw new Error(`User not found: ${enrollment.userId}`);

    const [course] = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, enrollment.courseId))
      .limit(1);

    const courseTitle = course?.title ?? "Your RecallIQ Course";

    if (data.type === "exam-followup") {
      const html = renderExamFollowUpEmail({
        ...(user.name ? { recipientName: user.name } : {}),
        courseTitle,
        enrollmentId: data.enrollmentId,
        baseUrl: BASE_URL,
      });

      await sendEmail({
        to: user.email,
        subject: `How did your ${courseTitle} exam go?`,
        html,
      });
    } else {
      // type === "maintenance"
      const html = renderMaintenanceReminderEmail({
        ...(user.name ? { recipientName: user.name } : {}),
        courseTitle,
        enrollmentId: data.enrollmentId,
        intervalLabel: data.intervalLabel,
        questionCount: data.questionCount,
        sessionMinutes: data.sessionMinutes,
        baseUrl: BASE_URL,
      });

      await sendEmail({
        to: user.email,
        subject: `Your ${data.intervalLabel} ${courseTitle} recall check-in`,
        html,
      });
    }
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 5,
      duration: 1000,
    },
  },
);

examFollowUpWorker.on("completed", (job) => {
  console.info(`Exam follow-up job ${job.id} completed`);
});

examFollowUpWorker.on("failed", (job, err) => {
  console.error(`Exam follow-up job ${job?.id} failed:`, err);
});

examFollowUpWorker.on("error", (err) => {
  console.error("Exam follow-up worker error:", err);
});

// ---------------------------------------------------------------------------
// Voice call worker — places scheduled outbound calls
// ---------------------------------------------------------------------------

const voiceCallWorker = new Worker<VoiceCallJobData>(
  VOICE_CALL_QUEUE,
  async (job) => {
    const { enrollmentId, phoneNumber } = job.data;
    job.log(`Placing outbound call to ${phoneNumber} for enrollment ${enrollmentId}`);

    const client = twilio(
      process.env["TWILIO_ACCOUNT_SID"] ?? "",
      process.env["TWILIO_AUTH_TOKEN"] ?? "",
    );

    const call = await client.calls.create({
      to: phoneNumber,
      from: process.env["TWILIO_PHONE_NUMBER"] ?? "",
      url: `${process.env["API_BASE_URL"] ?? "http://localhost:3001"}/twiml/review-call?enrollmentId=${enrollmentId}`,
      statusCallback: `${process.env["API_BASE_URL"] ?? "http://localhost:3001"}/webhooks/call-status`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed", "failed", "no-answer"],
    });

    job.log(`Call initiated: callSid=${call.sid}`);
  },
  {
    connection: redis,
    concurrency: 3,
    // Rate-limit: Twilio allows ~1 call/s per number by default
    limiter: { max: 1, duration: 1100 },
  },
);

voiceCallWorker.on("completed", (job) => {
  console.info(`Voice call job ${job.id} completed`);
});

voiceCallWorker.on("failed", (job, err) => {
  console.error(`Voice call job ${job?.id} failed:`, err);
});

voiceCallWorker.on("error", (err) => {
  console.error("Voice call worker error:", err);
});

console.info("RecallIQ worker started");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.info("SIGTERM received, closing worker...");
  await Promise.all([worker.close(), examFollowUpWorker.close(), voiceCallWorker.close()]);
  await redis.quit();
  process.exit(0);
});
