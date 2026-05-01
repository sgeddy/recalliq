import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  and,
  cards,
  count,
  courses,
  db,
  desc,
  enrollments,
  eq,
  inArray,
  isNull,
  lte,
  min,
  modules,
  notificationJobs,
  reviewEvents,
  sql,
  users,
} from "@recalliq/db";

import { createClerkClient } from "@clerk/fastify";

import { computePreparednessScore } from "@recalliq/srs-engine";
import { certConfigs } from "@recalliq/types";

import { buildRequireAuth } from "../plugins/clerk-auth.js";
import { parseBody, parseParams, parseQuery } from "../plugins/zod-validator.js";
import {
  examFollowUpQueue,
  reviewNotificationQueue,
  type ExamFollowUpJobData,
  type ReviewNotificationJobData,
} from "../lib/queue.js";

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const clerkClient = createClerkClient({ secretKey: process.env["CLERK_SECRET_KEY"]! });

// Deterministic Fisher-Yates shuffle using a seeded LCG.
// Produces the same order for the same (array, seed) pair every time.
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// Derive a numeric seed from a UUID by XORing two 32-bit hex segments.
function seedFromUUID(id: string): number {
  const hex = id.replace(/-/g, "");
  return (parseInt(hex.slice(0, 8), 16) ^ parseInt(hex.slice(8, 16), 16)) >>> 0;
}

function toStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Free-recall cards must not leak the model answer or grading keywords until
// the user submits a response — both fields are stripped before sending.
interface SessionCardLike {
  type: string;
  back: string;
  acceptableAnswers: string[] | null;
  [key: string]: unknown;
}
function maskFreeRecallAnswer<T extends SessionCardLike>(card: T): T {
  if (card.type !== "free_recall") return card;
  return { ...card, back: "", acceptableAnswers: null };
}

async function fetchClerkEmail(clerkId: string): Promise<{ email: string; name: string | null }> {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkId}@clerk.recalliq.internal`;
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
  return { email, name };
}

const requireAuth = buildRequireAuth();

const createEnrollmentSchema = z.object({
  courseId: z.string().uuid(),
  goalType: z.enum(["short_term", "long_term", "custom"]).default("long_term"),
  goalDate: z.string().datetime().optional(),
  channels: z.array(z.enum(["email", "sms", "voice", "push"])).default(["email"]),
});

const enrollmentIdSchema = z.object({
  id: z.string().uuid(),
});

const activeCourseQuerySchema = z.object({
  courseId: z.string().uuid(),
});

export const enrollmentRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /enrollments/active?courseId=:courseId
  // Returns the user's active enrollment for a course, or null if not enrolled.
  // Must be registered before /:id routes so "active" isn't parsed as a UUID param.
  fastify.get("/enrollments/active", { preHandler: [requireAuth] }, async (request, reply) => {
    const { courseId } = parseQuery(request, activeCourseQuerySchema);
    const clerkId = request.userId as string;

    const [userRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!userRow) {
      return reply.status(200).send({ data: null });
    }

    const [enrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, userRow.id),
          eq(enrollments.courseId, courseId),
          eq(enrollments.status, "active"),
        ),
      )
      .limit(1);

    return reply.status(200).send({
      data: enrollment ? { enrollmentId: enrollment.id } : null,
    });
  });

  // GET /enrollments
  // Lists all enrollments for the authenticated user. Fetches all review events
  // in a single query and aggregates per-enrollment stats + preparedness score
  // in TypeScript (simpler than equivalent SQL window functions).
  fastify.get("/enrollments", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = request.userId as string;

    const [userRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!userRow) {
      return reply.status(200).send({ data: [] });
    }

    // Step 1: all enrollments with course metadata.
    const enrollmentRows = await db
      .select({
        id: enrollments.id,
        status: enrollments.status,
        createdAt: enrollments.createdAt,
        examDate: enrollments.examDate,
        courseId: enrollments.courseId,
        courseTitle: courses.title,
        courseSlug: courses.slug,
        defaultIntervals: courses.defaultIntervals,
      })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(eq(enrollments.userId, userRow.id))
      .orderBy(desc(enrollments.createdAt));

    if (enrollmentRows.length === 0) {
      return reply.status(200).send({ data: [] });
    }

    const enrollmentIds = enrollmentRows.map((e) => e.id);

    // Step 2: all review events for those enrollments in one query.
    const allEvents = await db
      .select({
        enrollmentId: reviewEvents.enrollmentId,
        cardId: reviewEvents.cardId,
        intervalIndex: reviewEvents.intervalIndex,
        scheduledAt: reviewEvents.scheduledAt,
        completedAt: reviewEvents.completedAt,
        passed: reviewEvents.passed,
        moduleId: modules.id,
        modulePosition: modules.position,
      })
      .from(reviewEvents)
      .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
      .innerJoin(modules, eq(modules.id, cards.moduleId))
      .where(inArray(reviewEvents.enrollmentId, enrollmentIds));

    const now = new Date();

    // Step 3: aggregate per enrollment.
    const result = enrollmentRows.map((enrollment) => {
      const events = allEvents.filter((e) => e.enrollmentId === enrollment.id);
      const completedEvents = events.filter((e) => e.completedAt !== null);
      const uniqueCardIds = new Set(events.map((e) => e.cardId));

      const hasDueCards = events.some((e) => e.completedAt === null && e.scheduledAt <= now);
      const nextSessionAt =
        events
          .filter((e) => e.completedAt === null && e.scheduledAt > now)
          .map((e) => e.scheduledAt)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

      // Build per-card stats keyed by cardId for preparedness computation.
      const cardMap = new Map<
        string,
        {
          modulePosition: number;
          intervalIndex: number;
          attempts: number;
          correct: number;
          lastReviewedAt: Date | null;
        }
      >();

      for (const event of events) {
        let c = cardMap.get(event.cardId);
        if (!c) {
          c = {
            modulePosition: event.modulePosition,
            intervalIndex: 0,
            attempts: 0,
            correct: 0,
            lastReviewedAt: null,
          };
          cardMap.set(event.cardId, c);
        }
        // Track the highest interval the card has reached, including the
        // pending row scheduled for the next review. After a correct first
        // pass the original index-0 row is completed and a new index-1 row is
        // created — the card's "current level" is 1, not 0.
        if (event.intervalIndex > c.intervalIndex) c.intervalIndex = event.intervalIndex;
        if (event.completedAt !== null) {
          c.attempts++;
          if (event.passed === true) c.correct++;
          if (!c.lastReviewedAt || event.completedAt > c.lastReviewedAt) {
            c.lastReviewedAt = event.completedAt;
          }
        }
      }

      // Group cards by module position → domain for preparedness.
      const certConfig = certConfigs[enrollment.courseSlug];
      const domainMap = new Map<
        number,
        {
          weightPercent: number;
          cards: typeof cardMap extends Map<string, infer V> ? V[] : never[];
        }
      >();

      for (const [, card] of cardMap) {
        let domain = domainMap.get(card.modulePosition);
        if (!domain) {
          const weight = certConfig?.domains[card.modulePosition - 1]?.weightPercent ?? null;
          domain = { weightPercent: weight ?? 0, cards: [] };
          domainMap.set(card.modulePosition, domain);
        }
        domain.cards.push(card);
      }

      // Equal weight fallback when no cert config weights are available.
      const domainArray = [...domainMap.values()];
      const hasWeights = domainArray.some((d) => d.weightPercent > 0);
      if (!hasWeights && domainArray.length > 0) {
        const equalWeight = 100 / domainArray.length;
        for (const d of domainArray) d.weightPercent = equalWeight;
      }

      const preparednessScore = computePreparednessScore(
        domainArray,
        enrollment.defaultIntervals,
        now,
      );

      return {
        id: enrollment.id,
        status: enrollment.status,
        createdAt: enrollment.createdAt,
        examDate: enrollment.examDate,
        courseId: enrollment.courseId,
        courseTitle: enrollment.courseTitle,
        courseSlug: enrollment.courseSlug,
        totalCards: uniqueCardIds.size,
        completedReviews: completedEvents.length,
        hasDueCards,
        nextSessionAt,
        preparednessScore,
      };
    });

    return reply.status(200).send({ data: result });
  });

  // POST /enrollments
  fastify.post("/enrollments", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseBody(request, createEnrollmentSchema);
    // requireAuth guarantees userId is non-null here
    const clerkId = request.userId as string;

    // Verify course exists and is published
    const [course] = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, body.courseId), eq(courses.status, "published")))
      .limit(1);

    if (!course) {
      const err = Object.assign(new Error(`Course not found: ${body.courseId}`), {
        statusCode: 404,
      });
      throw err;
    }

    const { email: clerkEmail, name: clerkName } = await fetchClerkEmail(clerkId);

    const existingUsers = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

    let user = existingUsers[0];

    if (!user) {
      const inserted = await db
        .insert(users)
        .values({ clerkId, email: clerkEmail, name: clerkName })
        .returning();
      user = inserted[0]!;
    } else if (user.email.endsWith("@clerk.recalliq.internal")) {
      // Backfill placeholder email from a previous enrollment
      const updated = await db
        .update(users)
        .set({ email: clerkEmail, name: clerkName })
        .where(eq(users.id, user.id))
        .returning();
      user = updated[0]!;
    }

    // Return existing active enrollment rather than creating a duplicate.
    const [existing] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, user.id),
          eq(enrollments.courseId, course.id),
          eq(enrollments.status, "active"),
        ),
      )
      .limit(1);

    if (existing) {
      return reply.status(200).send({ data: { id: existing.id } });
    }

    // Create the enrollment
    const now = new Date();
    const goalDate = body.goalDate ? new Date(body.goalDate) : null;

    const insertedEnrollments = await db
      .insert(enrollments)
      .values({
        userId: user.id,
        courseId: course.id,
        goalType: body.goalType ?? "long_term",
        goalDate,
        channels: (body.channels ?? ["email"]) as ("email" | "sms" | "voice" | "push")[],
        status: "active",
      })
      .returning();

    const enrollment = insertedEnrollments[0]!;

    // Fetch all cards for the course via modules
    const courseCards = await db
      .select({ id: cards.id, type: cards.type })
      .from(cards)
      .innerJoin(modules, eq(cards.moduleId, modules.id))
      .where(eq(modules.courseId, course.id));

    if (courseCards.length === 0) {
      // No cards yet — return the enrollment without scheduling reviews
      await reply.status(201).send({ data: enrollment });
      return;
    }

    // For each card, create the first review_event scheduled at now + intervals[0] days.
    // Round to start-of-day UTC so all cards in a session share the same scheduledAt,
    // allowing the worker to bundle them into one email per channel.
    const firstIntervalDays = (course.defaultIntervals[0] ?? 1) as number;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const rawScheduledAt = new Date(now.getTime() + firstIntervalDays * MS_PER_DAY);
    const firstScheduledAt = toStartOfDay(rawScheduledAt);

    const reviewEventInserts = courseCards.map((card) => ({
      enrollmentId: enrollment.id,
      cardId: card.id,
      intervalIndex: 0,
      scheduledAt: firstScheduledAt,
      completedAt: null as Date | null,
      passed: null as boolean | null,
    }));

    const createdReviewEvents = await db
      .insert(reviewEvents)
      .values(reviewEventInserts)
      .returning();

    // For each review_event × channel, create a notification_job and enqueue a BullMQ job
    const jobInserts = createdReviewEvents.flatMap((reviewEvent) =>
      (body.channels ?? ["email"]).map((channel) => ({
        enrollmentId: enrollment.id,
        reviewEventId: reviewEvent.id,
        channel: channel as "email" | "sms" | "voice" | "push",
        status: "pending" as const,
        scheduledAt: firstScheduledAt,
      })),
    );

    await db.insert(notificationJobs).values(jobInserts);

    // Enqueue ONE BullMQ job per channel (not per card). The worker fetches all
    // pending notification_jobs for the session and sends one bundled email.
    // Give users a 5-minute window to start the quiz in-app before the email fires.
    // The session/start endpoint cancels the job if they click "Start now" in time.
    const GRACE_PERIOD_MS = 5 * 60 * 1000;
    const rawDelayMs = firstScheduledAt.getTime() - now.getTime();
    const delayMs =
      firstIntervalDays === 0 ? Math.max(GRACE_PERIOD_MS, rawDelayMs) : Math.max(0, rawDelayMs);
    const uniqueChannels = [...new Set(body.channels)];

    await Promise.all(
      uniqueChannels.map((channel) => {
        const jobData: ReviewNotificationJobData = {
          enrollmentId: enrollment.id,
          channel: channel as "email" | "sms" | "voice" | "push",
          scheduledAt: firstScheduledAt.toISOString(),
        };
        // Deterministic jobId prevents duplicate BullMQ jobs for the same session.
        const jobId = `session-${enrollment.id}-${channel}-${firstScheduledAt.getTime()}`;
        return reviewNotificationQueue.add(jobId, jobData, {
          delay: Math.max(0, delayMs),
          jobId,
        });
      }),
    );

    await reply.status(201).send({ data: enrollment });
  });

  // GET /enrollments/:id/progress
  fastify.get(
    "/enrollments/:id/progress",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;

      // Resolve the internal user record for this Clerk identity
      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);

      if (!userRow) {
        const err = Object.assign(new Error("User not found"), { statusCode: 404 });
        throw err;
      }

      // Fetch enrollment and verify ownership (multi-tenant)
      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
        .limit(1);

      if (!enrollment) {
        const err = Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
        throw err;
      }

      // Completed cards: review_events with completedAt set and passed=true
      const [completedResult] = await db
        .select({ completedCount: count() })
        .from(reviewEvents)
        .where(and(eq(reviewEvents.enrollmentId, id), eq(reviewEvents.passed, true)));

      // Pending reviews: review_events not yet completed
      const [pendingResult] = await db
        .select({ pendingCount: count() })
        .from(reviewEvents)
        .where(and(eq(reviewEvents.enrollmentId, id), isNull(reviewEvents.completedAt)));

      // Next review date: earliest scheduledAt among pending events
      const [nextReviewResult] = await db
        .select({ nextReviewAt: min(reviewEvents.scheduledAt) })
        .from(reviewEvents)
        .where(and(eq(reviewEvents.enrollmentId, id), isNull(reviewEvents.completedAt)));

      await reply.status(200).send({
        data: {
          enrollment,
          completedCards: completedResult?.completedCount ?? 0,
          pendingReviews: pendingResult?.pendingCount ?? 0,
          nextReviewAt: nextReviewResult?.nextReviewAt ?? null,
        },
      });
    },
  );

  // GET /enrollments/:id/session
  // Returns due reviews and a capped batch of new cards for the session quiz.
  // Due reviews (intervalIndex > 0, scheduledAt <= now) are always included.
  // New cards (intervalIndex = 0) are capped to floor(sessionMinutes * 60 / 90).
  // The cap is based on the enrollment's sessionConfig (default: 60 min → 40 cards).
  // Seeded shuffle stabilises card order across resumes within a batch.
  fastify.get("/enrollments/:id/session", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, enrollmentIdSchema);
    const clerkId = request.userId as string;

    const [userRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!userRow) {
      const err = Object.assign(new Error("User not found"), { statusCode: 404 });
      throw err;
    }

    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
      .limit(1);

    if (!enrollment) {
      const err = Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
      throw err;
    }

    const [course] = await db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.id, enrollment.courseId))
      .limit(1);

    const sessionMinutes = enrollment.sessionConfig?.dailyStudyMinutes ?? 60;
    const sessionCap = Math.floor((sessionMinutes * 60) / 90);

    const now = new Date();

    // ── Due reviews (intervalIndex > 0, scheduledAt <= now) ──────────────────
    // Include both completed and pending to anchor stable shuffle order on resume.
    const allDueReviewEvents = await db
      .select({
        reviewEventId: reviewEvents.id,
        completedAt: reviewEvents.completedAt,
        intervalIndex: reviewEvents.intervalIndex,
        cardId: cards.id,
        type: cards.type,
        front: cards.front,
        back: cards.back,
        options: cards.options,
        correctOptionIndex: cards.correctOptionIndex,
        correctOptionIndices: cards.correctOptionIndices,
        acceptableAnswers: cards.acceptableAnswers,
      })
      .from(reviewEvents)
      .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
      .where(
        and(
          eq(reviewEvents.enrollmentId, id),
          lte(reviewEvents.scheduledAt, now),
          sql`${reviewEvents.intervalIndex} > 0`,
        ),
      );

    const shuffledDueReviews = seededShuffle(allDueReviewEvents, seedFromUUID(id));
    const completedDueReviews = shuffledDueReviews.filter((e) => e.completedAt !== null).length;
    const pendingDueReviews = shuffledDueReviews
      .filter((e) => e.completedAt === null)
      .map(({ completedAt: _c, ...card }) => maskFreeRecallAnswer(card));

    // ── New cards (intervalIndex = 0) ─────────────────────────────────────────
    // Return ALL pending new cards. The session picker (client-side) trims to
    // the user's chosen duration; capping here previously stranded cards whose
    // shuffle position fell past the cap once the first batch was completed.
    const allNewCardEvents = await db
      .select({
        reviewEventId: reviewEvents.id,
        completedAt: reviewEvents.completedAt,
        intervalIndex: reviewEvents.intervalIndex,
        cardId: cards.id,
        type: cards.type,
        front: cards.front,
        back: cards.back,
        options: cards.options,
        correctOptionIndex: cards.correctOptionIndex,
        correctOptionIndices: cards.correctOptionIndices,
        acceptableAnswers: cards.acceptableAnswers,
      })
      .from(reviewEvents)
      .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
      .where(and(eq(reviewEvents.enrollmentId, id), sql`${reviewEvents.intervalIndex} = 0`));

    // Use a different seed offset for new cards to avoid collisions with due-review shuffle.
    const newCardShuffle = seededShuffle(allNewCardEvents, seedFromUUID(id) ^ 0xdeadbeef);
    const completedNewCards = newCardShuffle.filter((e) => e.completedAt !== null).length;
    const pendingNewCards = newCardShuffle
      .filter((e) => e.completedAt === null)
      .map(({ completedAt: _c, ...card }) => maskFreeRecallAnswer(card));

    await reply.status(200).send({
      data: {
        enrollmentId: id,
        courseTitle: course?.title ?? "Your RecallIQ Course",
        sessionMinutes,
        sessionCap,
        dueReviews: pendingDueReviews,
        newCards: pendingNewCards,
        completedDueReviews,
        completedNewCards,
      },
    });
  });

  // POST /enrollments/:id/session/start
  // Called when the user opens the session page in-app. Cancels the pending
  // BullMQ email reminder so it doesn't fire while they're already doing the quiz.
  fastify.post(
    "/enrollments/:id/session/start",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;

      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);

      if (!userRow) {
        const err = Object.assign(new Error("User not found"), { statusCode: 404 });
        throw err;
      }

      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
        .limit(1);

      if (!enrollment) {
        const err = Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
        throw err;
      }

      // Find the earliest pending notification job to derive the BullMQ job ID.
      const [earliest] = await db
        .select({ scheduledAt: notificationJobs.scheduledAt })
        .from(notificationJobs)
        .where(and(eq(notificationJobs.enrollmentId, id), eq(notificationJobs.status, "pending")))
        .orderBy(notificationJobs.scheduledAt)
        .limit(1);

      if (earliest) {
        const CHANNELS = ["email", "sms", "voice", "push"] as const;
        await Promise.allSettled(
          CHANNELS.map(async (channel) => {
            const jobId = `session-${id}-${channel}-${earliest.scheduledAt.getTime()}`;
            const job = await reviewNotificationQueue.getJob(jobId);
            await job?.remove();
          }),
        );
      }

      await reply.status(200).send({ data: { ok: true } });
    },
  );

  // PATCH /enrollments/:id/exam-date
  // Sets the exam date on the enrollment and schedules a follow-up job for the day after.
  fastify.patch(
    "/enrollments/:id/exam-date",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;

      const examDateSchema = z.object({
        examDate: z.string().datetime(),
      });
      const { examDate } = parseBody(request, examDateSchema);

      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);

      if (!userRow) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }

      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
        .limit(1);

      if (!enrollment) {
        throw Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
      }

      const examDateObj = new Date(examDate);

      await db
        .update(enrollments)
        .set({ examDate: examDateObj, updatedAt: new Date() })
        .where(eq(enrollments.id, id));

      // Cancel any existing follow-up job for this enrollment before scheduling a new one.
      const existingJobId = `exam-followup-${id}`;
      const existingJob = await examFollowUpQueue.getJob(existingJobId);
      await existingJob?.remove();

      // Schedule the follow-up email for the morning after the exam (8 AM UTC).
      const followUpDate = new Date(examDateObj);
      followUpDate.setUTCDate(followUpDate.getUTCDate() + 1);
      followUpDate.setUTCHours(8, 0, 0, 0);

      const delayMs = Math.max(0, followUpDate.getTime() - Date.now());
      const jobData: ExamFollowUpJobData = {
        type: "exam-followup",
        enrollmentId: id,
        examDate,
      };

      await examFollowUpQueue.add(existingJobId, jobData, {
        delay: delayMs,
        jobId: existingJobId,
      });

      await reply.status(200).send({ data: { ok: true, examDate } });
    },
  );

  // PATCH /enrollments/:id/session-config
  // Persists the user's study plan settings (from the StudyPlanCalculator).
  // These settings drive the session size cap in GET /enrollments/:id/session.
  fastify.patch(
    "/enrollments/:id/session-config",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;

      const sessionConfigSchema = z.object({
        dailyStudyMinutes: z.number().int().min(1).max(480),
        weeksUntilExam: z.number().int().min(1).max(52),
        chronotype: z.enum(["morning", "neutral", "evening"]),
        priorKnowledge: z.enum(["none", "basic", "experienced"]),
      });
      const config = parseBody(request, sessionConfigSchema);

      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);

      if (!userRow) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }

      const [enrollment] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
        .limit(1);

      if (!enrollment) {
        throw Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
      }

      await db
        .update(enrollments)
        .set({ sessionConfig: config, updatedAt: new Date() })
        .where(eq(enrollments.id, id));

      await reply.status(200).send({ data: { ok: true } });
    },
  );

  // POST /enrollments/:id/exam-result
  // Records whether the user passed or failed. Pass → schedule maintenance jobs + complete
  // enrollment. Fail → keep enrollment active so the SRS schedule continues.
  fastify.post(
    "/enrollments/:id/exam-result",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;

      const examResultSchema = z.object({
        result: z.enum(["pass", "fail"]),
        score: z.number().int().min(0).optional(),
      });
      const { result, score } = parseBody(request, examResultSchema);

      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);

      if (!userRow) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }

      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
        .limit(1);

      if (!enrollment) {
        throw Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
      }

      if (result === "pass") {
        // Mark enrollment as completed and stop pending review reminders.
        await db
          .update(enrollments)
          .set({
            examResult: "pass",
            examScore: score ?? null,
            status: "completed",
            updatedAt: new Date(),
          })
          .where(eq(enrollments.id, id));

        // Cancel all pending study-session notification jobs so reminders stop.
        const pendingJobs = await db
          .select({ scheduledAt: notificationJobs.scheduledAt })
          .from(notificationJobs)
          .where(
            and(eq(notificationJobs.enrollmentId, id), eq(notificationJobs.status, "pending")),
          );

        const uniqueTimestamps = [...new Set(pendingJobs.map((j) => j.scheduledAt.getTime()))];
        const CHANNELS = ["email", "sms", "voice", "push"] as const;

        await Promise.allSettled(
          uniqueTimestamps.flatMap((ts) =>
            CHANNELS.map(async (channel) => {
              const jobId = `session-${id}-${channel}-${ts}`;
              const job = await reviewNotificationQueue.getJob(jobId);
              await job?.remove();
            }),
          ),
        );

        // Schedule post-exam maintenance jobs using the exam date (fall back to now).
        const examBase = enrollment.examDate ?? new Date();
        const MS_PER_DAY = 24 * 60 * 60 * 1000;

        const maintenanceIntervals = [
          { label: "1 month", daysAfterExam: 30, questionCount: 20, sessionMinutes: 30 },
          { label: "3 months", daysAfterExam: 90, questionCount: 30, sessionMinutes: 45 },
          { label: "6 months", daysAfterExam: 180, questionCount: 30, sessionMinutes: 45 },
          { label: "1 year", daysAfterExam: 365, questionCount: 50, sessionMinutes: 60 },
        ];

        await Promise.all(
          maintenanceIntervals.map(({ label, daysAfterExam, questionCount, sessionMinutes }) => {
            const fireAt = new Date(examBase.getTime() + daysAfterExam * MS_PER_DAY);
            fireAt.setUTCHours(8, 0, 0, 0);
            const delayMs = Math.max(0, fireAt.getTime() - Date.now());
            const jobId = `maintenance-${id}-${daysAfterExam}d`;
            const jobData: ExamFollowUpJobData = {
              type: "maintenance",
              enrollmentId: id,
              intervalLabel: label,
              questionCount,
              sessionMinutes,
            };
            return examFollowUpQueue.add(jobId, jobData, { delay: delayMs, jobId });
          }),
        );
      } else {
        // Fail — keep enrollment active; the existing SRS schedule continues.
        await db
          .update(enrollments)
          .set({ examResult: "fail", examScore: score ?? null, updatedAt: new Date() })
          .where(eq(enrollments.id, id));
      }

      await reply.status(200).send({ data: { ok: true, result } });
    },
  );

  // GET /enrollments/:id/dashboard
  // Returns a full aggregated view of the enrollment for the learner dashboard:
  // overall stats, per-domain breakdown, session history, upcoming schedule, per-card stats.
  fastify.get(
    "/enrollments/:id/dashboard",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;

      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1);

      if (!userRow) {
        throw Object.assign(new Error("User not found"), { statusCode: 404 });
      }

      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(and(eq(enrollments.id, id), eq(enrollments.userId, userRow.id)))
        .limit(1);

      if (!enrollment) {
        throw Object.assign(new Error("Enrollment not found"), { statusCode: 404 });
      }

      const [course] = await db
        .select({
          title: courses.title,
          slug: courses.slug,
          defaultIntervals: courses.defaultIntervals,
        })
        .from(courses)
        .where(eq(courses.id, enrollment.courseId))
        .limit(1);

      // One query: all review events for this enrollment joined with card + module.
      // Aggregation happens in TypeScript — simpler than many SQL subqueries and
      // well within acceptable memory for per-user event counts.
      const allEvents = await db
        .select({
          reviewEventId: reviewEvents.id,
          cardId: reviewEvents.cardId,
          intervalIndex: reviewEvents.intervalIndex,
          scheduledAt: reviewEvents.scheduledAt,
          completedAt: reviewEvents.completedAt,
          passed: reviewEvents.passed,
          cardFront: cards.front,
          cardBack: cards.back,
          cardType: cards.type,
          moduleId: modules.id,
          moduleName: modules.title,
          modulePosition: modules.position,
        })
        .from(reviewEvents)
        .innerJoin(cards, eq(cards.id, reviewEvents.cardId))
        .innerJoin(modules, eq(modules.id, cards.moduleId))
        .where(eq(reviewEvents.enrollmentId, id));

      const now = new Date();

      // ── Overall stats ────────────────────────────────────────────────────
      const completedEvents = allEvents.filter((e) => e.completedAt !== null);
      const uniqueCardIds = new Set(allEvents.map((e) => e.cardId));
      const attemptedCardIds = new Set(completedEvents.map((e) => e.cardId));
      const correctReviews = completedEvents.filter((e) => e.passed === true).length;
      const incorrectReviews = completedEvents.filter((e) => e.passed === false).length;

      // ── Per-domain breakdown ─────────────────────────────────────────────
      const moduleMap = new Map<
        string,
        {
          moduleId: string;
          moduleName: string;
          modulePosition: number;
          cardIds: Set<string>;
          attemptedCardIds: Set<string>;
          correctReviews: number;
          totalReviews: number;
        }
      >();

      for (const event of allEvents) {
        let m = moduleMap.get(event.moduleId);
        if (!m) {
          m = {
            moduleId: event.moduleId,
            moduleName: event.moduleName,
            modulePosition: event.modulePosition,
            cardIds: new Set(),
            attemptedCardIds: new Set(),
            correctReviews: 0,
            totalReviews: 0,
          };
          moduleMap.set(event.moduleId, m);
        }
        m.cardIds.add(event.cardId);
        if (event.completedAt !== null) {
          m.attemptedCardIds.add(event.cardId);
          m.totalReviews++;
          if (event.passed === true) m.correctReviews++;
        }
      }

      const domains = [...moduleMap.values()]
        .sort((a, b) => a.modulePosition - b.modulePosition)
        .map((m) => ({
          moduleId: m.moduleId,
          moduleName: m.moduleName,
          modulePosition: m.modulePosition,
          totalCards: m.cardIds.size,
          attemptedCards: m.attemptedCardIds.size,
          correctReviews: m.correctReviews,
          totalReviews: m.totalReviews,
        }));

      // ── Session history (group completed events by UTC date of completedAt) ──
      const sessionDateMap = new Map<string, { reviewed: number; correct: number }>();
      for (const event of completedEvents) {
        const date = event.completedAt!.toISOString().split("T")[0]!;
        const s = sessionDateMap.get(date) ?? { reviewed: 0, correct: 0 };
        s.reviewed++;
        if (event.passed === true) s.correct++;
        sessionDateMap.set(date, s);
      }
      const pastSessions = [...sessionDateMap.entries()]
        .map(([date, s]) => ({ date, reviewed: s.reviewed, correct: s.correct }))
        .sort((a, b) => b.date.localeCompare(a.date));

      // ── Upcoming sessions (group future pending events by scheduledAt date) ──
      const upcomingDateMap = new Map<string, number>();
      for (const event of allEvents) {
        if (event.completedAt === null && event.scheduledAt > now) {
          const date = event.scheduledAt.toISOString().split("T")[0]!;
          upcomingDateMap.set(date, (upcomingDateMap.get(date) ?? 0) + 1);
        }
      }
      const upcomingSessions = [...upcomingDateMap.entries()]
        .map(([date, cardCount]) => ({ date, cardCount }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 10);

      // ── Per-card stats ────────────────────────────────────────────────────
      const cardStatsMap = new Map<
        string,
        {
          cardId: string;
          moduleId: string;
          moduleName: string;
          modulePosition: number;
          front: string;
          back: string;
          cardType: string;
          attempts: number;
          correct: number;
          currentIntervalIndex: number;
          lastReviewedAt: Date | null;
          nextDueAt: string | null;
        }
      >();

      for (const event of allEvents) {
        let c = cardStatsMap.get(event.cardId);
        if (!c) {
          c = {
            cardId: event.cardId,
            moduleId: event.moduleId,
            moduleName: event.moduleName,
            modulePosition: event.modulePosition,
            front: event.cardFront,
            back: event.cardBack,
            cardType: event.cardType,
            attempts: 0,
            correct: 0,
            currentIntervalIndex: 0,
            lastReviewedAt: null,
            nextDueAt: null,
          };
          cardStatsMap.set(event.cardId, c);
        }
        // Track the highest interval the card has reached across all events.
        // A pending index-1 row created after a correct first pass means the
        // card has graduated to level 1 — counting only completed events
        // would leave it stuck at 0 between reviews.
        if (event.intervalIndex > c.currentIntervalIndex) {
          c.currentIntervalIndex = event.intervalIndex;
        }
        if (event.completedAt !== null) {
          c.attempts++;
          if (event.passed === true) c.correct++;
          if (!c.lastReviewedAt || event.completedAt > c.lastReviewedAt) {
            c.lastReviewedAt = event.completedAt;
          }
        } else if (event.scheduledAt >= now) {
          if (!c.nextDueAt || event.scheduledAt.toISOString() < c.nextDueAt) {
            c.nextDueAt = event.scheduledAt.toISOString();
          }
        }
      }

      const cardStats = [...cardStatsMap.values()];

      // ── Preparedness score ────────────────────────────────────────────────
      const certConfig = certConfigs[course?.slug ?? ""];
      const domainMap = new Map<
        number,
        {
          weightPercent: number;
          cards: {
            intervalIndex: number;
            attempts: number;
            correct: number;
            lastReviewedAt: Date | null;
          }[];
        }
      >();

      for (const c of cardStats) {
        let d = domainMap.get(c.modulePosition);
        if (!d) {
          const weight = certConfig?.domains[c.modulePosition - 1]?.weightPercent ?? null;
          d = { weightPercent: weight ?? 0, cards: [] };
          domainMap.set(c.modulePosition, d);
        }
        d.cards.push({
          intervalIndex: c.currentIntervalIndex,
          attempts: c.attempts,
          correct: c.correct,
          lastReviewedAt: c.lastReviewedAt,
        });
      }

      const domainArray = [...domainMap.values()];
      const hasWeights = domainArray.some((d) => d.weightPercent > 0);
      if (!hasWeights && domainArray.length > 0) {
        const equalWeight = 100 / domainArray.length;
        for (const d of domainArray) d.weightPercent = equalWeight;
      }

      const preparednessScore = computePreparednessScore(
        domainArray,
        course?.defaultIntervals ?? [],
        now,
      );

      // Check if there are cards due today (for "Start session" CTA)
      const hasDueCards = allEvents.some((e) => e.completedAt === null && e.scheduledAt <= now);

      // Strip internal fields before sending to client.
      const clientCardStats = cardStats.map(
        ({ modulePosition: _p, lastReviewedAt: _r, ...rest }) => rest,
      );

      await reply.status(200).send({
        data: {
          enrollment: {
            id: enrollment.id,
            status: enrollment.status,
            createdAt: enrollment.createdAt,
            examDate: enrollment.examDate,
            examResult: enrollment.examResult,
            sessionConfig: enrollment.sessionConfig ?? null,
          },
          course: {
            title: course?.title ?? "",
            slug: course?.slug ?? "",
            defaultIntervals: course?.defaultIntervals ?? [],
          },
          stats: {
            totalCards: uniqueCardIds.size,
            attemptedCards: attemptedCardIds.size,
            totalReviews: completedEvents.length,
            correctReviews,
            incorrectReviews,
            hasDueCards,
            preparednessScore,
          },
          domains,
          sessions: {
            past: pastSessions,
            upcoming: upcomingSessions,
          },
          cards: clientCardStats,
        },
      });
    },
  );
};
