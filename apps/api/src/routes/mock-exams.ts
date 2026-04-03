import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  and,
  cards,
  db,
  desc,
  enrollments,
  eq,
  inArray,
  mockExamAnswers,
  mockExamSessions,
  modules,
  users,
} from "@recalliq/db";

import { buildRequireAuth } from "../plugins/clerk-auth.js";
import { parseBody, parseParams } from "../plugins/zod-validator.js";
import { examFollowUpQueue, type ExamFollowUpJobData } from "../lib/queue.js";

// CompTIA SY0-701 domain weights — used to select questions proportionally.
const DOMAIN_WEIGHTS: Record<string, number> = {
  "Domain 1: General Security Concepts": 0.12,
  "Domain 2: Threats, Vulnerabilities and Mitigations": 0.22,
  "Domain 3: Security Architecture": 0.18,
  "Domain 4: Security Operations": 0.28,
  "Domain 5: Security Program Management and Oversight": 0.2,
};

// Deterministic Fisher-Yates shuffle.
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

function seedFromUUID(id: string): number {
  const hex = id.replace(/-/g, "");
  return (parseInt(hex.slice(0, 8), 16) ^ parseInt(hex.slice(8, 16), 16)) >>> 0;
}

// Convert raw correct count to a CompTIA-style scaled score (100–900).
// Linear interpolation: 0% → 100, 100% → 900.
function toScaledScore(correct: number, total: number): number {
  if (total === 0) return 100;
  const ratio = correct / total;
  return Math.round(100 + ratio * 800);
}

const requireAuth = buildRequireAuth();

const enrollmentIdSchema = z.object({ enrollmentId: z.string().uuid() });
const sessionIdSchema = z.object({ id: z.string().uuid() });

// Resolve the internal user record and verify enrollment ownership.
async function resolveUserAndEnrollment(clerkId: string, enrollmentId: string) {
  const [userRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!userRow) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const [enrollment] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.userId, userRow.id)))
    .limit(1);
  if (!enrollment) throw Object.assign(new Error("Enrollment not found"), { statusCode: 404 });

  return { user: userRow, enrollment };
}

async function resolveSessionOwner(clerkId: string, sessionId: string) {
  const [userRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  if (!userRow) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const [session] = await db
    .select()
    .from(mockExamSessions)
    .where(eq(mockExamSessions.id, sessionId))
    .limit(1);
  if (!session) throw Object.assign(new Error("Mock exam session not found"), { statusCode: 404 });

  // Verify ownership via enrollment
  const [enrollment] = await db
    .select({ userId: enrollments.userId })
    .from(enrollments)
    .where(eq(enrollments.id, session.enrollmentId))
    .limit(1);
  if (!enrollment || enrollment.userId !== userRow.id) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }

  return { user: userRow, session };
}

// Select questions for a mock exam, weighted by domain.
async function selectMockExamQuestions(
  enrollmentId: string,
  questionCount: number,
  sessionId: string,
): Promise<{ cardId: string; domainName: string }[]> {
  // Get the courseId from the enrollment
  const [enrollment] = await db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(eq(enrollments.id, enrollmentId))
    .limit(1);
  if (!enrollment) return [];

  // Fetch all cards with their domain (module title)
  const allCards = await db
    .select({
      cardId: cards.id,
      domainName: modules.title,
    })
    .from(cards)
    .innerJoin(modules, eq(cards.moduleId, modules.id))
    .where(eq(modules.courseId, enrollment.courseId));

  if (allCards.length === 0) return [];

  // Group by domain
  const byDomain: Record<string, typeof allCards> = {};
  for (const card of allCards) {
    const d = card.domainName;
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d]!.push(card);
  }

  const seed = seedFromUUID(sessionId);
  const selected: { cardId: string; domainName: string }[] = [];

  // Select proportionally from each domain, shuffle within domain first
  for (const [domain, weight] of Object.entries(DOMAIN_WEIGHTS)) {
    const domainCards = byDomain[domain] ?? [];
    if (domainCards.length === 0) continue;
    const targetCount = Math.round(questionCount * weight);
    const shuffled = seededShuffle(domainCards, seed ^ domain.charCodeAt(0));
    selected.push(...shuffled.slice(0, Math.min(targetCount, domainCards.length)));
  }

  // If we have fewer than questionCount (small pool), fill remainder from any domain
  if (selected.length < questionCount) {
    const selectedIds = new Set(selected.map((c) => c.cardId));
    const remaining = allCards.filter((c) => !selectedIds.has(c.cardId));
    const shuffledRem = seededShuffle(remaining, seed ^ 0xdeadbeef);
    selected.push(...shuffledRem.slice(0, questionCount - selected.length));
  }

  // Final shuffle of the combined set
  return seededShuffle(selected.slice(0, questionCount), seed);
}

export const mockExamRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /enrollments/:enrollmentId/mock-exams
  // Schedule or immediately start a mock exam. Pass scheduledFor to book a future time;
  // omit it to start immediately.
  fastify.post(
    "/enrollments/:enrollmentId/mock-exams",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { enrollmentId } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;
      await resolveUserAndEnrollment(clerkId, enrollmentId);

      const bodySchema = z.object({
        scheduledFor: z.string().datetime().optional(),
        questionCount: z.number().int().min(10).max(90).default(85),
      });
      const body = parseBody(request, bodySchema);

      const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
      const status = scheduledFor && scheduledFor > new Date() ? "scheduled" : "in_progress";

      const [session] = await db
        .insert(mockExamSessions)
        .values({
          enrollmentId,
          status,
          scheduledFor,
          startedAt: status === "in_progress" ? new Date() : null,
          questionCount: body.questionCount ?? 85,
        })
        .returning();

      if (!session) throw new Error("Failed to create mock exam session");

      // If scheduled for the future, queue a reminder job (day before and morning of).
      if (scheduledFor && scheduledFor > new Date()) {
        const MS = 1;
        const dayBefore = new Date(scheduledFor.getTime() - 24 * 60 * 60 * 1000);
        const dayBeforeDelay = Math.max(0, dayBefore.getTime() - Date.now());
        const morningOfDelay = Math.max(0, scheduledFor.getTime() - Date.now());

        const reminderData: ExamFollowUpJobData = {
          type: "mock-exam-reminder" as unknown as "exam-followup",
          enrollmentId,
          examDate: scheduledFor.toISOString(),
        };

        // Day-before reminder
        if (dayBeforeDelay > MS) {
          await examFollowUpQueue.add(`mock-reminder-day-before-${session.id}`, reminderData, {
            delay: dayBeforeDelay,
            jobId: `mock-reminder-day-before-${session.id}`,
          });
        }
        // Morning-of reminder
        await examFollowUpQueue.add(`mock-reminder-morning-of-${session.id}`, reminderData, {
          delay: morningOfDelay,
          jobId: `mock-reminder-morning-of-${session.id}`,
        });
      }

      return reply.status(201).send({ data: session });
    },
  );

  // GET /enrollments/:enrollmentId/mock-exams
  // List all mock exam sessions for an enrollment.
  fastify.get(
    "/enrollments/:enrollmentId/mock-exams",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { enrollmentId } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;
      await resolveUserAndEnrollment(clerkId, enrollmentId);

      const sessions = await db
        .select()
        .from(mockExamSessions)
        .where(eq(mockExamSessions.enrollmentId, enrollmentId))
        .orderBy(desc(mockExamSessions.createdAt));

      return reply.status(200).send({ data: sessions });
    },
  );

  // GET /mock-exams/:id
  // Fetch a single session (status, score, domain breakdown).
  fastify.get("/mock-exams/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, sessionIdSchema);
    const clerkId = request.userId as string;
    const { session } = await resolveSessionOwner(clerkId, id);
    return reply.status(200).send({ data: session });
  });

  // POST /mock-exams/:id/start
  // Transition a scheduled session to in_progress and return the question set.
  fastify.post("/mock-exams/:id/start", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, sessionIdSchema);
    const clerkId = request.userId as string;
    const { session } = await resolveSessionOwner(clerkId, id);

    if (session.status === "completed" || session.status === "abandoned") {
      throw Object.assign(new Error("Session already finished"), { statusCode: 400 });
    }

    if (session.status === "scheduled") {
      await db
        .update(mockExamSessions)
        .set({ status: "in_progress", startedAt: new Date() })
        .where(eq(mockExamSessions.id, id));
    }

    // Select questions weighted by domain
    const questions = await selectMockExamQuestions(
      session.enrollmentId,
      session.questionCount,
      id,
    );

    // Fetch full card data for the selected question IDs
    const cardIds = questions.map((q) => q.cardId);
    const cardData =
      cardIds.length > 0
        ? await db
            .select({
              id: cards.id,
              type: cards.type,
              front: cards.front,
              options: cards.options,
              // NOTE: back (explanation) is intentionally excluded — shown only after submit
            })
            .from(cards)
            .where(inArray(cards.id, cardIds))
        : [];

    // Merge domain name back in and preserve shuffle order
    const domainByCardId = Object.fromEntries(questions.map((q) => [q.cardId, q.domainName]));
    const orderedCards = questions.map((q) => ({
      ...cardData.find((c) => c.id === q.cardId)!,
      domainName: domainByCardId[q.cardId],
    }));

    return reply.status(200).send({
      data: {
        sessionId: id,
        timeLimitSeconds: 90 * 60,
        cards: orderedCards,
      },
    });
  });

  // POST /mock-exams/:id/answers
  // Submit a single answer during the exam. Call once per question as the user answers.
  fastify.post("/mock-exams/:id/answers", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, sessionIdSchema);
    const clerkId = request.userId as string;
    const { session } = await resolveSessionOwner(clerkId, id);

    if (session.status !== "in_progress") {
      throw Object.assign(new Error("Session is not in progress"), { statusCode: 400 });
    }

    const bodySchema = z.object({
      cardId: z.string().uuid(),
      selectedOptionIndex: z.number().int().min(0).nullable(),
      responseTimeMs: z.number().int().min(0).optional(),
    });
    const body = parseBody(request, bodySchema);

    // Fetch correct answer and domain
    const [card] = await db
      .select({
        correctOptionIndex: cards.correctOptionIndex,
        domainName: modules.title,
      })
      .from(cards)
      .innerJoin(modules, eq(cards.moduleId, modules.id))
      .where(eq(cards.id, body.cardId))
      .limit(1);

    if (!card) throw Object.assign(new Error("Card not found"), { statusCode: 404 });

    const isCorrect =
      body.selectedOptionIndex !== null && body.selectedOptionIndex === card.correctOptionIndex;

    const [answer] = await db
      .insert(mockExamAnswers)
      .values({
        sessionId: id,
        cardId: body.cardId,
        selectedOptionIndex: body.selectedOptionIndex,
        isCorrect,
        responseTimeMs: body.responseTimeMs ?? null,
        domainName: card.domainName,
      })
      .returning();

    return reply.status(201).send({ data: answer });
  });

  // POST /mock-exams/:id/complete
  // Mark the session complete, calculate score and domain breakdown.
  fastify.post(
    "/mock-exams/:id/complete",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, sessionIdSchema);
      const clerkId = request.userId as string;
      const { session } = await resolveSessionOwner(clerkId, id);

      if (session.status !== "in_progress") {
        throw Object.assign(new Error("Session is not in progress"), { statusCode: 400 });
      }

      const bodySchema = z.object({
        durationSeconds: z.number().int().min(0).optional(),
      });
      const body = parseBody(request, bodySchema);

      // Aggregate answers
      const answers = await db
        .select()
        .from(mockExamAnswers)
        .where(eq(mockExamAnswers.sessionId, id));

      const correctCount = answers.filter((a) => a.isCorrect === true).length;
      const scaledScore = toScaledScore(correctCount, session.questionCount);
      const passed = scaledScore >= 750;

      // Domain breakdown
      const breakdown: Record<string, { correct: number; total: number }> = {};
      for (const a of answers) {
        const d = a.domainName ?? "Unknown";
        if (!breakdown[d]) breakdown[d] = { correct: 0, total: 0 };
        breakdown[d]!.total += 1;
        if (a.isCorrect) breakdown[d]!.correct += 1;
      }

      const [updated] = await db
        .update(mockExamSessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          durationSeconds: body.durationSeconds ?? null,
          correctCount,
          scaledScore,
          passed,
          domainBreakdown: breakdown,
        })
        .where(eq(mockExamSessions.id, id))
        .returning();

      return reply.status(200).send({ data: updated });
    },
  );

  // POST /mock-exams/:id/abandon
  fastify.post("/mock-exams/:id/abandon", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, sessionIdSchema);
    const clerkId = request.userId as string;
    await resolveSessionOwner(clerkId, id);

    await db
      .update(mockExamSessions)
      .set({ status: "abandoned", completedAt: new Date() })
      .where(eq(mockExamSessions.id, id));

    return reply.status(200).send({ data: { ok: true } });
  });

  // GET /mock-exams/:id/review
  // After completion, return each question with the user's answer, correct answer,
  // and full explanation. Used for the post-exam review screen.
  fastify.get("/mock-exams/:id/review", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, sessionIdSchema);
    const clerkId = request.userId as string;
    const { session } = await resolveSessionOwner(clerkId, id);

    if (session.status !== "completed") {
      throw Object.assign(new Error("Session not yet completed"), { statusCode: 400 });
    }

    const answers = await db
      .select({
        answerId: mockExamAnswers.id,
        cardId: mockExamAnswers.cardId,
        selectedOptionIndex: mockExamAnswers.selectedOptionIndex,
        isCorrect: mockExamAnswers.isCorrect,
        responseTimeMs: mockExamAnswers.responseTimeMs,
        domainName: mockExamAnswers.domainName,
        front: cards.front,
        back: cards.back,
        options: cards.options,
        correctOptionIndex: cards.correctOptionIndex,
      })
      .from(mockExamAnswers)
      .innerJoin(cards, eq(cards.id, mockExamAnswers.cardId))
      .where(eq(mockExamAnswers.sessionId, id))
      .orderBy(mockExamAnswers.createdAt);

    return reply.status(200).send({
      data: {
        session,
        answers,
      },
    });
  });

  // GET /mock-exams/:id/stats
  // Aggregated performance stats: score history trend, domain weaknesses.
  fastify.get(
    "/enrollments/:enrollmentId/mock-exams/stats",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { enrollmentId } = parseParams(request, enrollmentIdSchema);
      const clerkId = request.userId as string;
      await resolveUserAndEnrollment(clerkId, enrollmentId);

      const sessions = await db
        .select({
          id: mockExamSessions.id,
          status: mockExamSessions.status,
          scaledScore: mockExamSessions.scaledScore,
          passed: mockExamSessions.passed,
          correctCount: mockExamSessions.correctCount,
          questionCount: mockExamSessions.questionCount,
          domainBreakdown: mockExamSessions.domainBreakdown,
          completedAt: mockExamSessions.completedAt,
        })
        .from(mockExamSessions)
        .where(
          and(
            eq(mockExamSessions.enrollmentId, enrollmentId),
            eq(mockExamSessions.status, "completed"),
          ),
        )
        .orderBy(mockExamSessions.completedAt);

      // Aggregate domain weaknesses across all completed sessions
      const domainTotals: Record<string, { correct: number; total: number }> = {};
      for (const s of sessions) {
        if (!s.domainBreakdown) continue;
        for (const [domain, stats] of Object.entries(s.domainBreakdown)) {
          if (!domainTotals[domain]) domainTotals[domain] = { correct: 0, total: 0 };
          domainTotals[domain]!.correct += stats.correct;
          domainTotals[domain]!.total += stats.total;
        }
      }

      const domainPerformance = Object.entries(domainTotals).map(([domain, stats]) => ({
        domain,
        correct: stats.correct,
        total: stats.total,
        pct: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      }));

      return reply.status(200).send({
        data: {
          sessions,
          domainPerformance: domainPerformance.sort((a, b) => a.pct - b.pct), // weakest first
        },
      });
    },
  );
};
