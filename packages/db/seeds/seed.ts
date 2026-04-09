import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { count, eq, inArray } from "drizzle-orm";

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
  correctOptionIndices?: number[];
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

  const expectedCardCount = fixture.modules.reduce((s, m) => s + m.cards.length, 0);

  const [{ existingModuleCount }] = await db
    .select({ existingModuleCount: count() })
    .from(modules)
    .where(eq(modules.courseId, course!.id));

  if (existingModuleCount > 0) {
    // Compare actual card count against the fixture to detect stale seeds.
    const existingModuleRows = await db
      .select({ id: modules.id })
      .from(modules)
      .where(eq(modules.courseId, course!.id));
    const moduleIds = existingModuleRows.map((m) => m.id);
    const [{ existingCardCount }] = await db
      .select({ existingCardCount: count() })
      .from(cards)
      .where(inArray(cards.moduleId, moduleIds));

    if (existingCardCount === expectedCardCount) {
      console.info(`Already seeded correctly (${existingCardCount} cards) — skipping.`);
      console.info("Seed complete.");
      await pool.end();
      return;
    }

    if (process.env["FORCE_RESEED"] !== "true") {
      console.warn(
        `Card count mismatch: DB has ${existingCardCount}, fixture has ${expectedCardCount}.`,
      );
      console.warn(`Re-run with FORCE_RESEED=true to delete and re-seed.`);
      await pool.end();
      return;
    }

    console.info(
      `FORCE_RESEED: deleting ${existingModuleCount} modules (${existingCardCount} cards) and re-seeding.`,
    );
    await db.delete(modules).where(eq(modules.courseId, course!.id));
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
      correctOptionIndices: c.correctOptionIndices ?? null,
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
