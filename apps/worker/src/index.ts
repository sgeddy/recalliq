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

    // Fetch upload record for contentType, then mark as processing
    const [uploadRecord] = await db
      .select({ contentType: uploads.contentType })
      .from(uploads)
      .where(eq(uploads.id, uploadId))
      .limit(1);

    const contentType = uploadRecord?.contentType ?? "practice_exam";
    const extractionModel =
      contentType === "practice_exam" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514";

    await db
      .update(uploads)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(uploads.id, uploadId));

    job.log(`Content type: ${contentType}, extraction model: ${extractionModel}`);

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

      // Process each source separately to extract ALL questions, then merge.
      // This avoids Claude condensing/summarizing when given too much at once.
      const sourcesWithContent = sources.filter((s) => s.content);

      if (sourcesWithContent.length === 0) {
        throw new Error("No content could be extracted from sources");
      }

      const allSourceResults: GeneratedCourse[] = [];

      // Large documents get chunked to avoid hitting output token limits.
      // 288 MCQ questions as JSON ≈ 70-85k output tokens, but max_tokens caps at 64k.
      // Splitting at ~100k chars ensures each chunk produces ≤ 64k tokens of output.
      const MAX_CHUNK_CHARS = 100_000;

      function splitIntoChunks(text: string): string[] {
        if (text.length <= MAX_CHUNK_CHARS) return [text];

        const chunks: string[] = [];
        let start = 0;
        while (start < text.length) {
          let end = Math.min(start + MAX_CHUNK_CHARS, text.length);
          // Try to break at a double newline to avoid splitting a question
          if (end < text.length) {
            const breakPoint = text.lastIndexOf("\n\n", end);
            if (breakPoint > start + MAX_CHUNK_CHARS * 0.5) {
              end = breakPoint;
            }
          }
          chunks.push(text.slice(start, end));
          start = end;
        }
        return chunks;
      }

      function parseJsonFromResponse(text: string): string {
        let jsonText = text.trim();
        const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (fenceMatch) jsonText = fenceMatch[1]!.trim();
        if (!jsonText.startsWith("{")) {
          const firstBrace = jsonText.indexOf("{");
          const lastBrace = jsonText.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace !== -1) {
            jsonText = jsonText.slice(firstBrace, lastBrace + 1);
          }
        }
        return jsonText;
      }

      // Process all chunks from all sources, running up to MAX_PARALLEL at once.
      const MAX_PARALLEL = 3;

      interface ChunkTask {
        sourceName: string;
        chunk: string;
        label: string;
      }

      const chunkTasks: ChunkTask[] = [];
      for (const source of sourcesWithContent) {
        const content = source.content!;
        const chunks = splitIntoChunks(content);
        job.log(
          `Processing source: ${source.name} (${content.length} chars, ${chunks.length} chunk${chunks.length !== 1 ? "s" : ""})`,
        );
        for (let ci = 0; ci < chunks.length; ci++) {
          const label = chunks.length > 1 ? ` (chunk ${ci + 1}/${chunks.length})` : "";
          chunkTasks.push({ sourceName: source.name, chunk: chunks[ci]!, label });
        }
      }

      async function processChunk(task: ChunkTask): Promise<GeneratedCourse | null> {
        job.log(
          `Extracting questions from ${task.sourceName}${task.label} (${task.chunk.length} chars)`,
        );

        const stream = anthropic.messages.stream({
          model: extractionModel,
          max_tokens: 64000,
          system: CONTENT_PROCESSING_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Here is the study material to process. Extract EVERY question — do not skip or summarize. If this is a practice exam, extract ALL questions with their exact options and correct answers.\n\n${task.chunk}`,
            },
          ],
        });

        const message = await stream.finalMessage();

        const textBlock = message.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          job.log(`No text response for ${task.sourceName}${task.label}`);
          return null;
        }

        if (message.stop_reason === "max_tokens") {
          job.log(
            `WARNING: output truncated for ${task.sourceName}${task.label} — some questions may be missing`,
          );
        }

        const jsonText = parseJsonFromResponse(textBlock.text);

        try {
          const parsed = JSON.parse(jsonText) as GeneratedCourse;
          const cardCount = parsed.modules?.reduce((s, m) => s + m.cards.length, 0) ?? 0;
          job.log(
            `${task.sourceName}${task.label}: ${parsed.modules?.length ?? 0} modules, ${cardCount} cards`,
          );
          return parsed;
        } catch (parseErr) {
          job.log(`Failed to parse JSON for ${task.sourceName}${task.label}: ${String(parseErr)}`);
          return null;
        }
      }

      // Run chunks in batches of MAX_PARALLEL
      for (let i = 0; i < chunkTasks.length; i += MAX_PARALLEL) {
        const batch = chunkTasks.slice(i, i + MAX_PARALLEL);
        const results = await Promise.all(batch.map(processChunk));
        for (const result of results) {
          if (result) allSourceResults.push(result);
        }
      }

      if (allSourceResults.length === 0) {
        throw new Error("No valid results from any source");
      }

      // Step 1: Collect all unique cards across all sources (flat, deduplicated)
      const first = allSourceResults[0]!;
      const allCards: GeneratedCourse["modules"][0]["cards"] = [];
      const seenQuestions = new Set<string>();

      for (const result of allSourceResults) {
        for (const mod of result.modules ?? []) {
          for (const card of mod.cards) {
            const normalizedFront = card.front
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 100);
            if (!seenQuestions.has(normalizedFront)) {
              seenQuestions.add(normalizedFront);
              allCards.push(card);
            }
          }
        }
      }

      job.log(
        `Collected ${allCards.length} unique cards from ${allSourceResults.length} sources. Organizing into domains...`,
      );

      // Step 2: Use AI to organize cards into proper domain modules.
      // Send just the question text (not full card data) to classify each card
      // into the right domain, then rebuild the structure.
      const cardSummaries = allCards.map((c, i) => `[${i}] ${c.front.slice(0, 150)}`).join("\n");

      const organizeStream = anthropic.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16384,
        system: `You are organizing study questions into domain modules for a course.

Given a list of questions (each with an index number), assign each question to the most appropriate domain module. The modules should reflect the actual subject structure — for certification exams, use the official exam domains. For other topics, create 3-8 logical groupings.

For example, CompTIA Security+ SY0-701 has these domains:
- Domain 1.0 - General Security Concepts (12%)
- Domain 2.0 - Threats, Vulnerabilities, and Mitigations (22%)
- Domain 3.0 - Security Architecture (18%)
- Domain 4.0 - Security Operations (28%)
- Domain 5.0 - Security Program Management and Oversight (20%)

Respond with ONLY valid JSON:
{
  "title": "string — course title",
  "description": "string — 1-2 sentence summary",
  "category": "string",
  "difficulty": "beginner" | "intermediate" | "advanced",
  "modules": [
    {
      "title": "string — domain/module name",
      "description": "string",
      "position": 1,
      "cardIndices": [0, 1, 5, 12, ...]
    }
  ]
}

Every question index must appear in exactly one module. Do not skip any indices.`,
        messages: [
          {
            role: "user",
            content: `Organize these ${allCards.length} questions into domain modules:\n\n${cardSummaries}`,
          },
        ],
      });

      const organizeMessage = await organizeStream.finalMessage();
      const organizeBlock = organizeMessage.content.find((b) => b.type === "text");

      let generated: GeneratedCourse;

      if (organizeBlock && organizeBlock.type === "text") {
        let orgJson = organizeBlock.text.trim();
        const orgFence = orgJson.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
        if (orgFence) orgJson = orgFence[1]!.trim();
        if (!orgJson.startsWith("{")) {
          const fb = orgJson.indexOf("{");
          const lb = orgJson.lastIndexOf("}");
          if (fb !== -1 && lb !== -1) orgJson = orgJson.slice(fb, lb + 1);
        }

        try {
          const organization = JSON.parse(orgJson) as {
            title: string;
            description: string;
            category: string;
            difficulty: "beginner" | "intermediate" | "advanced";
            modules: {
              title: string;
              description: string;
              position: number;
              cardIndices: number[];
            }[];
          };

          // Rebuild modules with actual card data
          generated = {
            title: organization.title || first.title,
            description: organization.description || first.description,
            category: organization.category || first.category,
            difficulty: organization.difficulty || first.difficulty,
            modules: organization.modules.map((mod) => ({
              title: mod.title,
              description: mod.description,
              position: mod.position,
              cards: mod.cardIndices
                .filter((i) => i >= 0 && i < allCards.length)
                .map((i) => allCards[i]!),
            })),
          };

          // Assign any unassigned cards to the last module (typically the broadest)
          const assignedIndices = new Set(organization.modules.flatMap((m) => m.cardIndices));
          const unassigned = allCards.filter((_, i) => !assignedIndices.has(i));
          if (unassigned.length > 0 && generated.modules.length > 0) {
            const lastModule = generated.modules[generated.modules.length - 1]!;
            lastModule.cards.push(...unassigned);
            job.log(`${unassigned.length} unassigned cards added to "${lastModule.title}"`);
          }
        } catch {
          job.log("Failed to parse organization response, falling back to flat merge");
          generated = {
            title: first.title,
            description: first.description,
            category: first.category,
            difficulty: first.difficulty,
            modules: [
              {
                title: "All Questions",
                description: "All extracted questions",
                position: 1,
                cards: allCards,
              },
            ],
          };
        }
      } else {
        generated = {
          title: first.title,
          description: first.description,
          category: first.category,
          difficulty: first.difficulty,
          modules: [
            {
              title: "All Questions",
              description: "All extracted questions",
              position: 1,
              cards: allCards,
            },
          ],
        };
      }

      const totalCards = generated.modules.reduce((sum, m) => sum + m.cards.length, 0);
      job.log(
        `Organized: "${generated.title}" — ${generated.modules.length} modules, ${totalCards} cards (${seenQuestions.size} unique, from ${allSourceResults.length} sources)`,
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
