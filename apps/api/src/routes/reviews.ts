import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  and,
  cards,
  courses,
  db,
  enrollments,
  eq,
  modules,
  notificationJobs,
  reviewEvents,
  users,
} from "@recalliq/db";
import { getNextReview } from "@recalliq/srs-engine";

import { buildRequireAuth } from "../plugins/clerk-auth.js";
import { parseBody, parseParams } from "../plugins/zod-validator.js";
import { reviewNotificationQueue, type ReviewNotificationJobData } from "../lib/queue.js";

const requireAuth = buildRequireAuth();

function toStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const reviewIdSchema = z.object({
  id: z.string().uuid(),
});

const submitReviewSchema = z.object({
  passed: z.boolean(),
  responseTime: z.number().int().min(0).optional(),
});

export const reviewRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /reviews/:id — fetch review event + card for the quiz page
  fastify.get("/reviews/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, reviewIdSchema);
    const clerkId = request.userId as string;

    // Resolve internal user
    const [userRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!userRow) {
      const err = Object.assign(new Error("User not found"), { statusCode: 404 });
      throw err;
    }

    // Fetch review event
    const [reviewEvent] = await db
      .select()
      .from(reviewEvents)
      .where(eq(reviewEvents.id, id))
      .limit(1);

    if (!reviewEvent) {
      const err = Object.assign(new Error("Review event not found"), { statusCode: 404 });
      throw err;
    }

    // Multi-tenant: verify the enrollment belongs to the authenticated user
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.id, reviewEvent.enrollmentId), eq(enrollments.userId, userRow.id)))
      .limit(1);

    if (!enrollment) {
      const err = Object.assign(new Error("Review event not found"), { statusCode: 404 });
      throw err;
    }

    // Fetch the card
    const [card] = await db.select().from(cards).where(eq(cards.id, reviewEvent.cardId)).limit(1);

    if (!card) {
      const err = Object.assign(new Error("Card not found"), { statusCode: 404 });
      throw err;
    }

    await reply.status(200).send({
      data: {
        reviewEvent,
        card,
      },
    });
  });

  // POST /reviews/:id/submit
  fastify.post("/reviews/:id/submit", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, reviewIdSchema);
    const body = parseBody(request, submitReviewSchema);
    const clerkId = request.userId as string;

    // Resolve internal user
    const [userRow] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!userRow) {
      const err = Object.assign(new Error("User not found"), { statusCode: 404 });
      throw err;
    }

    // Fetch review event
    const [reviewEvent] = await db
      .select()
      .from(reviewEvents)
      .where(eq(reviewEvents.id, id))
      .limit(1);

    if (!reviewEvent) {
      const err = Object.assign(new Error("Review event not found"), { statusCode: 404 });
      throw err;
    }

    // Verify this review event belongs to an enrollment owned by the authenticated user
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.id, reviewEvent.enrollmentId), eq(enrollments.userId, userRow.id)))
      .limit(1);

    if (!enrollment) {
      const err = Object.assign(new Error("Review event not found"), { statusCode: 404 });
      throw err;
    }

    // Idempotency guard — prevent double-submission
    if (reviewEvent.completedAt !== null) {
      const err = Object.assign(new Error("Review event already submitted"), {
        statusCode: 409,
      });
      throw err;
    }

    // Fetch the course to get the interval sequence
    const [module] = await db
      .select({ courseId: modules.courseId })
      .from(modules)
      .innerJoin(cards, eq(cards.moduleId, modules.id))
      .where(eq(cards.id, reviewEvent.cardId))
      .limit(1);

    if (!module) {
      const err = Object.assign(new Error("Card module not found"), { statusCode: 500 });
      throw err;
    }

    const [course] = await db
      .select({ defaultIntervals: courses.defaultIntervals })
      .from(courses)
      .where(eq(courses.id, module.courseId))
      .limit(1);

    if (!course) {
      const err = Object.assign(new Error("Course not found"), { statusCode: 500 });
      throw err;
    }

    const now = new Date();

    // Mark the review event as completed
    await db
      .update(reviewEvents)
      .set({
        completedAt: now,
        passed: body.passed,
        responseTime: body.responseTime ?? null,
      })
      .where(eq(reviewEvents.id, id));

    // Compute next review using the SRS engine
    const scheduleResult = getNextReview(
      {
        enrollmentId: enrollment.id,
        cardId: reviewEvent.cardId,
        intervalIndex: reviewEvent.intervalIndex,
        passed: body.passed,
      },
      course.defaultIntervals,
      now,
    );

    if (!scheduleResult.completed) {
      // Create the next review_event
      const nextReviewEventInserts = await db
        .insert(reviewEvents)
        .values({
          enrollmentId: enrollment.id,
          cardId: reviewEvent.cardId,
          intervalIndex: scheduleResult.nextIntervalIndex,
          scheduledAt: scheduleResult.nextScheduledAt,
        })
        .returning();

      const nextReviewEvent = nextReviewEventInserts[0]!;

      // Create notification_jobs for each channel
      const jobInserts = enrollment.channels.map((channel) => ({
        enrollmentId: enrollment.id,
        reviewEventId: nextReviewEvent.id,
        channel: channel as "email" | "sms" | "voice" | "push",
        status: "pending" as const,
        scheduledAt: scheduleResult.nextScheduledAt,
      }));

      const createdJobs = await db.insert(notificationJobs).values(jobInserts).returning();

      // Round to start-of-day so all cards answered in the same session share
      // the same scheduledAt, and the worker can bundle them into one email.
      const sessionDay = toStartOfDay(scheduleResult.nextScheduledAt);
      const delayMs = sessionDay.getTime() - now.getTime();

      await Promise.all(
        createdJobs.map((job) => {
          const jobData: ReviewNotificationJobData = {
            enrollmentId: enrollment.id,
            channel: job.channel,
            scheduledAt: sessionDay.toISOString(),
          };
          // Deterministic jobId deduplicates if multiple cards in this session
          // advance to the same next-session day.
          const jobId = `session-${enrollment.id}-${job.channel}-${sessionDay.getTime()}`;
          return reviewNotificationQueue.add(jobId, jobData, {
            delay: Math.max(0, delayMs),
            jobId,
          });
        }),
      );
    }

    await reply.status(200).send({
      data: {
        passed: body.passed,
        nextScheduledAt: scheduleResult.completed ? null : scheduleResult.nextScheduledAt,
        completed: scheduleResult.completed,
      },
    });
  });
};
