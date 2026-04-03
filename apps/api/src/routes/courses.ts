import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { cards, count, courses, db, eq, modules } from "@recalliq/db";

import { parseParams } from "../plugins/zod-validator.js";

const slugParamsSchema = z.object({
  slug: z.string().min(1),
});

export const courseRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /courses — list all published courses
  fastify.get("/courses", async (_request, reply) => {
    const allCourses = await db
      .select()
      .from(courses)
      .where(eq(courses.status, "published"))
      .orderBy(courses.title);

    // Fetch stats for each course in a single query
    const stats = await db
      .select({
        courseId: modules.courseId,
        moduleCount: count(modules.id).as("module_count"),
      })
      .from(modules)
      .groupBy(modules.courseId);

    const statsByCourseId = Object.fromEntries(
      stats.map((s) => [s.courseId, s.moduleCount]),
    );

    const result = allCourses.map((course) => ({
      ...course,
      moduleCount: statsByCourseId[course.id] ?? 0,
    }));

    await reply.send({ data: result });
  });

  // GET /courses/:slug — get course detail with module/card counts
  fastify.get("/courses/:slug", async (request, reply) => {
    const { slug } = parseParams(request, slugParamsSchema);

    const [course] = await db
      .select()
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);

    if (!course) {
      const error = Object.assign(new Error(`Course not found: ${slug}`), {
        statusCode: 404,
      });
      throw error;
    }

    // Get modules with card counts
    const courseModules = await db
      .select({
        id: modules.id,
        title: modules.title,
        position: modules.position,
        description: modules.description,
        cardCount: count(cards.id).as("card_count"),
      })
      .from(modules)
      .leftJoin(cards, eq(cards.moduleId, modules.id))
      .where(eq(modules.courseId, course.id))
      .groupBy(modules.id)
      .orderBy(modules.position);

    const totalCardCount = courseModules.reduce((sum, m) => sum + m.cardCount, 0);

    await reply.send({
      data: {
        ...course,
        moduleCount: courseModules.length,
        cardCount: totalCardCount,
        modules: courseModules,
      },
    });
  });
};
