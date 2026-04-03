import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { count, eq } from "drizzle-orm";

import { cards, courses, modules } from "../src/schema.js";

// ---------------------------------------------------------------------------
// Types for the seed fixture format
// ---------------------------------------------------------------------------

interface SeedCard {
  type: "flashcard" | "mcq" | "free_recall";
  front: string;
  back: string;
  options?: string[];
  correctOptionIndex?: number;
  tags: string[];
}

interface SeedModule {
  title: string;
  position: number;
  description?: string;
  cards: SeedCard[];
}

interface SeedFixture {
  course: {
    slug: string;
    title: string;
    description: string;
    category: string;
    difficulty: "beginner" | "intermediate" | "advanced";
    defaultIntervals: number[];
    passMark: number;
    status: "draft" | "published";
  };
  modules: SeedModule[];
}

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  const connectionString =
    process.env["DATABASE_URL"] ?? "postgresql://postgres:password@localhost:5432/recalliq";

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  const fixturePath = join(__dirname, "security-plus.json");
  const raw = await readFile(fixturePath, "utf-8");
  const fixture = JSON.parse(raw) as SeedFixture;

  console.info(`Seeding course: ${fixture.course.title}`);

  // Upsert course — updates defaultIntervals and metadata if slug already exists,
  // so re-running the seed picks up interval schedule changes.
  const [course] = await db
    .insert(courses)
    .values({
      slug: fixture.course.slug,
      title: fixture.course.title,
      description: fixture.course.description,
      category: fixture.course.category,
      difficulty: fixture.course.difficulty,
      defaultIntervals: fixture.course.defaultIntervals,
      passMark: fixture.course.passMark,
      status: fixture.course.status,
    })
    .onConflictDoUpdate({
      target: courses.slug,
      set: {
        defaultIntervals: fixture.course.defaultIntervals,
        title: fixture.course.title,
        description: fixture.course.description,
        status: fixture.course.status,
      },
    })
    .returning();

  console.info(`Upserted course: ${course!.id}`);

  // Skip module/card insertion if already seeded — modules have no unique constraint
  // beyond their primary key, so onConflictDoNothing cannot detect duplicates.
  const [{ existingCount }] = await db
    .select({ existingCount: count() })
    .from(modules)
    .where(eq(modules.courseId, course!.id));

  if (existingCount > 0) {
    console.info(`Modules already seeded for "${fixture.course.slug}" — skipping.`);
    console.info("Seed complete.");
    await pool.end();
    return;
  }

  for (const seedModule of fixture.modules) {
    const [mod] = await db
      .insert(modules)
      .values({
        courseId: course.id,
        title: seedModule.title,
        position: seedModule.position,
        description: seedModule.description ?? null,
      })
      .onConflictDoNothing()
      .returning();

    if (!mod) {
      console.info(`Module "${seedModule.title}" already exists — skipping.`);
      continue;
    }

    console.info(`  Created module: ${mod.title} (${seedModule.cards.length} cards)`);

    const cardValues = seedModule.cards.map((c) => ({
      moduleId: mod.id,
      type: c.type,
      front: c.front,
      back: c.back,
      options: c.options ?? null,
      correctOptionIndex: c.correctOptionIndex ?? null,
      tags: c.tags,
    }));

    await db.insert(cards).values(cardValues).onConflictDoNothing();
  }

  console.info("Seed complete.");
  await pool.end();
}

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
