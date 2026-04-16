import type { FastifyPluginAsync } from "fastify";
import multipart from "@fastify/multipart";
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
  uploads,
  uploadSources,
  users,
} from "@recalliq/db";

import type { GeneratedCourse } from "@recalliq/types";

import { createClerkClient } from "@clerk/fastify";

import { buildRequireAuth } from "../plugins/clerk-auth.js";
import { parseBody, parseParams } from "../plugins/zod-validator.js";
import {
  contentProcessingQueue,
  reviewNotificationQueue,
  type ReviewNotificationJobData,
} from "../lib/queue.js";

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const clerkClient = createClerkClient({ secretKey: process.env["CLERK_SECRET_KEY"]! });

const requireAuth = buildRequireAuth();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_SOURCES_PER_UPLOAD = 10;
const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

// Only allow safe filename characters — strip path separators and null bytes
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\0\\/:\*\?"<>\|]/g, "_")
    .replace(/\.\./g, "_")
    .slice(0, 255);
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

async function extractTextFromBuffer(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return buffer.toString("utf-8");
  }

  if (mimeType === "application/pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw Object.assign(new Error(`Unsupported file type: ${mimeType}`), {
    statusCode: 400,
  });
}

function toStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function fetchClerkEmail(clerkId: string): Promise<{ email: string; name: string | null }> {
  const clerkUser = await clerkClient.users.getUser(clerkId);
  const email = clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkId}@clerk.recalliq.internal`;
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
  return { email, name };
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const idParamsSchema = z.object({ id: z.string().uuid() });

const addUrlSchema = z.object({
  url: z
    .string()
    .url()
    .max(MAX_URL_LENGTH, "URL is too long")
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          return parsed.protocol === "https:" || parsed.protocol === "http:";
        } catch {
          return false;
        }
      },
      { message: "Only http and https URLs are allowed" },
    )
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          // Block private/internal IPs
          const host = parsed.hostname;
          return (
            !host.startsWith("127.") &&
            !host.startsWith("10.") &&
            !host.startsWith("192.168.") &&
            !host.startsWith("172.") &&
            host !== "localhost" &&
            host !== "0.0.0.0" &&
            !host.endsWith(".local") &&
            !host.endsWith(".internal")
          );
        } catch {
          return false;
        }
      },
      { message: "URLs pointing to private or internal addresses are not allowed" },
    ),
});

export const uploadRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: { fileSize: MAX_FILE_SIZE },
  });

  // ── POST /uploads ─── Create upload and attach files ──────────────────────
  fastify.post("/uploads", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = request.userId as string;

    // Upsert user
    const { email: clerkEmail, name: clerkName } = await fetchClerkEmail(clerkId);
    const existingUsers = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

    let user = existingUsers[0];

    if (!user) {
      const inserted = await db
        .insert(users)
        .values({ clerkId, email: clerkEmail, name: clerkName })
        .returning();
      user = inserted[0]!;
    }

    // Parse multipart — collect files and field values
    const parts = request.parts();
    const fileSources: { name: string; mimeType: string; content: string }[] = [];
    const urlSources: string[] = [];
    let title: string | null = null;

    for await (const part of parts) {
      if (part.type === "field") {
        const val = typeof part.value === "string" ? part.value.trim() : "";
        if (part.fieldname === "title" && val) {
          title = val.slice(0, MAX_TITLE_LENGTH);
        }
        if (part.fieldname === "url" && val) {
          // Validate URL: only http/https, no private IPs
          try {
            const parsed = new URL(val);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
            const host = parsed.hostname;
            if (
              host.startsWith("127.") ||
              host.startsWith("10.") ||
              host.startsWith("192.168.") ||
              host.startsWith("172.") ||
              host === "localhost" ||
              host === "0.0.0.0" ||
              host.endsWith(".local") ||
              host.endsWith(".internal")
            ) {
              continue;
            }
            if (val.length <= MAX_URL_LENGTH) {
              urlSources.push(val);
            }
          } catch {
            // Skip invalid URLs silently
          }
        }
        continue;
      }

      // part.type === "file" — skip empty file fields (no file selected)
      if (!part.filename) continue;

      if (!ALLOWED_MIME_TYPES.has(part.mimetype)) {
        throw Object.assign(
          new Error(`Unsupported file type: ${part.mimetype}. Allowed: PDF, DOCX, TXT, MD`),
          { statusCode: 400 },
        );
      }

      const buffer = await part.toBuffer();
      if (buffer.length === 0) continue;

      const text = await extractTextFromBuffer(buffer, part.mimetype);

      fileSources.push({
        name: sanitizeFilename(part.filename),
        mimeType: part.mimetype,
        content: text,
      });
    }

    const totalSources = fileSources.length + urlSources.length;
    if (totalSources === 0) {
      throw Object.assign(new Error("At least one file or URL is required"), {
        statusCode: 400,
      });
    }
    if (totalSources > MAX_SOURCES_PER_UPLOAD) {
      throw Object.assign(
        new Error(`Too many sources. Maximum ${MAX_SOURCES_PER_UPLOAD} per upload.`),
        { statusCode: 400 },
      );
    }

    // Create upload record
    const [upload] = await db
      .insert(uploads)
      .values({
        userId: user.id,
        title,
        status: "pending",
      })
      .returning();

    // Insert file sources
    const sourceInserts = [
      ...fileSources.map((s) => ({
        uploadId: upload!.id,
        sourceType: "file" as const,
        name: s.name,
        mimeType: s.mimeType,
        content: s.content,
      })),
      ...urlSources.map((url) => ({
        uploadId: upload!.id,
        sourceType: "url" as const,
        name: url,
        mimeType: null,
        content: null,
      })),
    ];

    await db.insert(uploadSources).values(sourceInserts);

    // Enqueue processing job
    await contentProcessingQueue.add(
      `process-${upload!.id}`,
      { uploadId: upload!.id },
      { jobId: `process-${upload!.id}` },
    );

    return reply.status(202).send({ data: { uploadId: upload!.id } });
  });

  // ── POST /uploads/:id/sources/url ─── Add a URL source to an upload ──────
  fastify.post(
    "/uploads/:id/sources/url",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = parseParams(request, idParamsSchema);
      const body = parseBody(request, addUrlSchema);
      const clerkId = request.userId as string;

      const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

      if (!user) {
        throw Object.assign(new Error("User not found"), { statusCode: 401 });
      }

      const [upload] = await db
        .select()
        .from(uploads)
        .where(and(eq(uploads.id, id), eq(uploads.userId, user.id)))
        .limit(1);

      if (!upload) {
        throw Object.assign(new Error("Upload not found"), {
          statusCode: 404,
        });
      }

      if (upload.status !== "pending") {
        throw Object.assign(new Error("Cannot add sources after processing has started"), {
          statusCode: 400,
        });
      }

      // URL content is fetched by the worker during processing
      const [source] = await db
        .insert(uploadSources)
        .values({
          uploadId: id,
          sourceType: "url",
          name: body.url,
          content: null,
        })
        .returning();

      return reply.status(201).send({ data: source });
    },
  );

  // ── GET /uploads/:id ─── Poll upload status ───────────────────────────────
  fastify.get("/uploads/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, idParamsSchema);
    const clerkId = request.userId as string;

    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 401 });
    }

    const [upload] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.userId, user.id)))
      .limit(1);

    if (!upload) {
      throw Object.assign(new Error("Upload not found"), {
        statusCode: 404,
      });
    }

    const sources = await db
      .select({
        id: uploadSources.id,
        sourceType: uploadSources.sourceType,
        name: uploadSources.name,
      })
      .from(uploadSources)
      .where(eq(uploadSources.uploadId, id));

    return reply.send({
      data: {
        id: upload.id,
        title: upload.title,
        status: upload.status,
        generatedPayload: upload.status === "review" ? upload.generatedPayload : null,
        courseId: upload.courseId,
        errorMessage: upload.errorMessage,
        sources,
        createdAt: upload.createdAt,
      },
    });
  });

  // ── POST /uploads/:id/confirm ─── Accept generated curriculum ─────────────
  fastify.post("/uploads/:id/confirm", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = parseParams(request, idParamsSchema);
    const clerkId = request.userId as string;

    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

    if (!user) {
      throw Object.assign(new Error("User not found"), { statusCode: 401 });
    }

    const [upload] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.userId, user.id)))
      .limit(1);

    if (!upload) {
      throw Object.assign(new Error("Upload not found"), {
        statusCode: 404,
      });
    }

    if (upload.status !== "review") {
      throw Object.assign(
        new Error(`Upload is not ready for confirmation (status: ${upload.status})`),
        { statusCode: 400 },
      );
    }

    const generated = upload.generatedPayload as GeneratedCourse;

    if (!generated?.modules?.length) {
      throw Object.assign(new Error("No generated content found"), { statusCode: 400 });
    }

    // Default SRS interval schedule
    const defaultIntervals = [0, 1, 3, 7, 14, 30, 60, 120];

    // Generate unique slug
    const baseSlug = slugify(generated.title);
    const slug = `${baseSlug}-${Date.now().toString(36)}`;

    // Create course + modules + cards + enrollment in one flow
    const [course] = await db
      .insert(courses)
      .values({
        userId: user.id,
        slug,
        title: generated.title,
        description: generated.description,
        category: generated.category,
        difficulty: generated.difficulty,
        defaultIntervals,
        passMark: 75,
        status: "published",
      })
      .returning();

    const allCardInserts: {
      moduleId: string;
      type: "flashcard" | "mcq" | "free_recall";
      front: string;
      back: string;
      options: string[] | null;
      correctOptionIndex: number | null;
      correctOptionIndices: number[] | null;
      tags: string[];
    }[] = [];

    for (const mod of generated.modules) {
      const [insertedModule] = await db
        .insert(modules)
        .values({
          courseId: course!.id,
          title: mod.title,
          position: mod.position,
          description: mod.description,
        })
        .returning();

      for (const card of mod.cards) {
        allCardInserts.push({
          moduleId: insertedModule!.id,
          type: card.type,
          front: card.front,
          back: card.back,
          options: card.options,
          correctOptionIndex: card.correctOptionIndex,
          correctOptionIndices: card.correctOptionIndices,
          tags: card.tags,
        });
      }
    }

    let createdCards: { id: string }[] = [];
    if (allCardInserts.length > 0) {
      createdCards = await db.insert(cards).values(allCardInserts).returning({ id: cards.id });
    }

    // Create enrollment
    const now = new Date();
    const [enrollment] = await db
      .insert(enrollments)
      .values({
        userId: user.id,
        courseId: course!.id,
        goalType: "long_term",
        channels: ["email"],
        status: "active",
      })
      .returning();

    // Create initial review events for all cards
    if (createdCards.length > 0) {
      const firstIntervalDays = defaultIntervals[0] ?? 0;
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const rawScheduledAt = new Date(now.getTime() + firstIntervalDays * MS_PER_DAY);
      const firstScheduledAt = toStartOfDay(rawScheduledAt);

      const reviewEventInserts = createdCards.map((card) => ({
        enrollmentId: enrollment!.id,
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

      // Create notification jobs
      const jobInserts = createdReviewEvents.map((re) => ({
        enrollmentId: enrollment!.id,
        reviewEventId: re.id,
        channel: "email" as const,
        status: "pending" as const,
        scheduledAt: firstScheduledAt,
      }));

      await db.insert(notificationJobs).values(jobInserts);

      // Enqueue BullMQ notification
      const delayMs = Math.max(0, firstScheduledAt.getTime() - now.getTime());
      const jobData: ReviewNotificationJobData = {
        enrollmentId: enrollment!.id,
        channel: "email",
        scheduledAt: firstScheduledAt.toISOString(),
      };
      const jobId = `session-${enrollment!.id}-email-${firstScheduledAt.getTime()}`;
      await reviewNotificationQueue.add(jobId, jobData, {
        delay: delayMs,
        jobId,
      });
    }

    // Update upload record
    await db
      .update(uploads)
      .set({
        status: "confirmed",
        courseId: course!.id,
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, id));

    return reply.status(201).send({
      data: {
        courseId: course!.id,
        enrollmentId: enrollment!.id,
        cardCount: createdCards.length,
        moduleCount: generated.modules.length,
      },
    });
  });

  // ── GET /uploads ─── List user's uploads ──────────────────────────────────
  fastify.get("/uploads", { preHandler: [requireAuth] }, async (request, reply) => {
    const clerkId = request.userId as string;

    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

    if (!user) {
      return reply.send({ data: [] });
    }

    const userUploads = await db
      .select({
        id: uploads.id,
        title: uploads.title,
        status: uploads.status,
        courseId: uploads.courseId,
        errorMessage: uploads.errorMessage,
        createdAt: uploads.createdAt,
      })
      .from(uploads)
      .where(eq(uploads.userId, user.id))
      .orderBy(uploads.createdAt);

    return reply.send({ data: userUploads });
  });
};
