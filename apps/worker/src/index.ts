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
import Anthropic from "@anthropic-ai/sdk";

import {
  and,
  courses,
  db,
  enrollments,
  eq,
  lte,
  notificationJobs,
  reviewEvents,
  uploads,
  uploadSources,
  users,
} from "@recalliq/db";

import type { GeneratedCourse } from "@recalliq/types";

import {
  REVIEW_NOTIFICATION_QUEUE,
  type ReviewNotificationJobData,
} from "./queues/review-notifications.js";
import { EXAM_FOLLOWUP_QUEUE, type ExamFollowUpJobData } from "./queues/exam-followup.js";
import {
  CONTENT_PROCESSING_QUEUE,
  type ContentProcessingJobData,
} from "./queues/content-processing.js";
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

// ---------------------------------------------------------------------------
// Content processing worker — AI course generation from uploaded content
// ---------------------------------------------------------------------------

const CONTENT_PROCESSING_SYSTEM_PROMPT = `You are an expert curriculum designer for a spaced-repetition study tool called RecallIQ.

Given study material, your job is to create a comprehensive study course. The material may be:
- A practice exam with existing questions (extract them)
- A study guide, exam blueprint, or certification overview (generate questions from it)
- A mix of both

Follow these steps:

1. **Extract existing questions.** If the material contains practice exam questions with answer choices, extract them exactly as-is. Preserve the original question text, all answer options, and correct answer(s). For multi-select questions (e.g., "Select TWO", "Choose TWO"), set correctOptionIndices to an array of the correct option indices. For single-answer questions, set correctOptionIndex to the correct option's index and correctOptionIndices to null.

2. **Generate new study content using your own knowledge.** For any topic, domain, objective, or concept mentioned in the material — even if no questions exist for it — use your expertise to create comprehensive practice questions. This is critical: if the material is an exam guide or study outline, you MUST generate substantial content for EVERY topic and objective listed, drawing on your own knowledge of the subject matter. Don't just summarize — create real, exam-level questions that test understanding.

3. **Cover all domains and objectives thoroughly.** If the material lists exam domains with percentage weights (e.g., "Domain 1: 30%"), generate proportionally more questions for higher-weighted domains. Aim for at least 5-10 cards per domain/topic, more for heavily weighted areas.

4. **Organize into modules** by topic/domain. Each module should be a logical grouping matching the material's structure (e.g., exam domains, chapters, sections).

Question generation rules:
- MCQ questions MUST have exactly 4 options unless the source material specifies more.
- For "Select TWO" or multi-select questions: set correctOptionIndices to the array of correct indices (0-based), and set correctOptionIndex to null.
- For single-answer MCQs: set correctOptionIndex to the correct option's index (0-based), and set correctOptionIndices to null.
- The "back" field is the explanation/answer. For MCQs, explain WHY the correct answer(s) are correct and why the others are wrong.
- Tags should be lowercase, hyphenated keywords relevant to the card's topic.
- Generate a mix of card types: mcq (most common), flashcard, and free_recall.
- Questions should range from foundational knowledge to applied scenarios.
- Be thorough — aim for comprehensive coverage, not just surface-level.
- Generate at least 30 cards total, more if the material covers many topics.

Respond with ONLY valid JSON matching this schema:
{
  "title": "string — course title derived from the material",
  "description": "string — 1-2 sentence summary",
  "category": "string — broad topic category",
  "difficulty": "beginner" | "intermediate" | "advanced",
  "modules": [
    {
      "title": "string",
      "description": "string",
      "position": 1,
      "cards": [
        {
          "type": "mcq" | "flashcard" | "free_recall",
          "front": "string — the question or prompt",
          "back": "string — the answer/explanation",
          "options": ["string", ...] | null,
          "correctOptionIndex": number | null,
          "correctOptionIndices": [number, ...] | null,
          "tags": ["string", ...]
        }
      ]
    }
  ]
}`;

const anthropic = new Anthropic();

const contentProcessingWorker = new Worker<ContentProcessingJobData>(
  CONTENT_PROCESSING_QUEUE,
  async (job) => {
    const { uploadId } = job.data;

    job.log(`Processing content for upload ${uploadId}`);

    // Mark as processing
    await db
      .update(uploads)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(uploads.id, uploadId));

    try {
      // Fetch all sources for this upload
      const sources = await db
        .select()
        .from(uploadSources)
        .where(eq(uploadSources.uploadId, uploadId));

      if (sources.length === 0) {
        throw new Error("No sources found for upload");
      }

      // Fetch URL content for any URL sources that haven't been fetched yet
      for (const source of sources) {
        if (source.sourceType === "url" && !source.content) {
          job.log(`Fetching URL: ${source.name}`);
          try {
            const response = await fetch(source.name);
            if (!response.ok) {
              job.log(`Failed to fetch ${source.name}: ${response.status}`);
              continue;
            }
            const html = await response.text();
            // Strip HTML tags to get readable text
            const text = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/\s+/g, " ")
              .trim();

            await db
              .update(uploadSources)
              .set({ content: text })
              .where(eq(uploadSources.id, source.id));

            source.content = text;
          } catch (err) {
            job.log(`Error fetching URL ${source.name}: ${String(err)}`);
          }
        }
      }

      // Combine all source content
      const combinedContent = sources
        .filter((s) => s.content)
        .map((s) => `--- Source: ${s.name} ---\n\n${s.content}`)
        .join("\n\n");

      if (!combinedContent.trim()) {
        throw new Error("No content could be extracted from sources");
      }

      job.log(`Combined content length: ${combinedContent.length} characters`);

      // Call Claude to generate course structure
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16384,
        system: CONTENT_PROCESSING_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Here is the study material to process:\n\n${combinedContent}`,
          },
        ],
      });

      // Extract text response
      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from AI");
      }

      // Extract JSON from response — handle preamble text, markdown fences, etc.
      let jsonText = textBlock.text.trim();

      // Strip markdown code fences
      const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) {
        jsonText = fenceMatch[1]!.trim();
      }

      // If response starts with non-JSON text, find the first { and last }
      if (!jsonText.startsWith("{")) {
        const firstBrace = jsonText.indexOf("{");
        const lastBrace = jsonText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1) {
          jsonText = jsonText.slice(firstBrace, lastBrace + 1);
        }
      }

      const generated = JSON.parse(jsonText) as GeneratedCourse;

      // Validate basic structure
      if (!generated.title || !generated.modules?.length) {
        throw new Error("AI response missing required fields (title, modules)");
      }

      const totalCards = generated.modules.reduce((sum, m) => sum + m.cards.length, 0);
      job.log(
        `Generated: "${generated.title}" — ${generated.modules.length} modules, ${totalCards} cards`,
      );

      // Store result and mark as ready for review
      await db
        .update(uploads)
        .set({
          title: generated.title,
          status: "review",
          generatedPayload: generated,
          updatedAt: new Date(),
        })
        .where(eq(uploads.id, uploadId));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      job.log(`Content processing failed: ${errorMessage}`);

      await db
        .update(uploads)
        .set({
          status: "failed",
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(uploads.id, uploadId));

      throw err;
    }
  },
  {
    connection: redis,
    concurrency: 2,
  },
);

contentProcessingWorker.on("completed", (job) => {
  console.info(`Content processing job ${job.id} completed`);
});

contentProcessingWorker.on("failed", (job, err) => {
  console.error(`Content processing job ${job?.id} failed:`, err);
});

contentProcessingWorker.on("error", (err) => {
  console.error("Content processing worker error:", err);
});

console.info("RecallIQ worker started");

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.info("SIGTERM received, closing worker...");
  await Promise.all([
    worker.close(),
    examFollowUpWorker.close(),
    voiceCallWorker.close(),
    contentProcessingWorker.close(),
  ]);
  await redis.quit();
  process.exit(0);
});
