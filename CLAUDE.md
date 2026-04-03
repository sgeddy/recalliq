# Project Instructions

## Commands

```bash
# Build
pnpm build               # build all packages and apps via Turborepo

# Test
pnpm test                # run full suite
pnpm test -- --filter=packages/srs-engine  # run single package tests

# Lint & Format
pnpm lint                # check style (ESLint + Prettier)
pnpm lint:fix            # auto-fix style
pnpm typecheck           # TypeScript type checking

# Dev
pnpm dev                 # start all apps in dev mode (Turborepo)
pnpm dev --filter=apps/api  # start a single app
```

## RecallIQ Architecture

Monorepo: Turborepo + pnpm workspaces
API: Fastify + Zod (apps/api)
Web: Next.js 14 App Router (apps/web)
Worker: BullMQ + Redis (apps/worker)
DB: Drizzle ORM + PostgreSQL (packages/db)
SRS: Pure TS scheduling engine (packages/srs-engine)
Notifications: Resend (email) + Twilio (SMS/voice) (packages/notifications)

```
recalliq/
  apps/
    web/      ← Next.js learner + admin frontend
    api/      ← Fastify REST API
    worker/   ← BullMQ job processor
  packages/
    db/           ← Drizzle schema + migrations
    srs-engine/   ← Spaced repetition scheduling logic
    notifications/ ← Twilio + Resend delivery adapters
    ui/           ← Shared component library
    types/        ← Shared TypeScript types
```

## Key Workflows

- New feature: branch from main, implement, run tests, `/ship`
- Auth changes: always invoke `@security-reviewer` before committing
- DB schema change: write migration in packages/db, never edit schema directly
- New notification channel: add adapter in packages/notifications, extend SendReviewJob type, update worker — never add channel logic elsewhere

## Agents to Use

- `@security-reviewer`: all auth, webhook, and payment code
- `@frontend-designer`: learner dashboard, course pages, quiz UI
- `@performance-reviewer`: DB queries touching review_events (high write volume)

## Key Decisions

- SRS scheduling is pure TypeScript with no framework dependencies (packages/srs-engine) — keeps it testable and portable
- All notification dispatch goes through BullMQ worker, never directly from API handlers — decouples delivery from request latency
- Prices stored in cents (integers) to avoid floating point errors in billing logic
- Multi-tenant isolation enforced at API layer: every user-data query filters by userId or enrollmentId

## Don'ts

- Don't modify generated files (`*.gen.ts`, `*.generated.*`, migration snapshots)
- Don't inline SRS scheduling logic outside packages/srs-engine
- Don't call Twilio or Resend directly from apps/api
- Don't hardcode credentials — .env only
