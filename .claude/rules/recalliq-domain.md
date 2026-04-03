---
description: RecallIQ domain rules — always loaded
alwaysApply: true
---

# RecallIQ Domain Rules

## SRS Engine
- ALL spaced repetition scheduling logic lives in packages/srs-engine ONLY
- Never inline interval math or scheduling decisions in apps/api or apps/worker
- SRS engine is pure TypeScript with zero framework dependencies
- Every scheduling change requires a Vitest unit test

## Multi-Tenancy
- Every DB query touching user data MUST filter by userId or enrollmentId
- Never return another user's review_events, enrollments, or progress data
- Validate ownership in the API layer before any read or write

## Monetary Values
- All prices stored in cents (integers), never floating point dollars
- Stripe amounts are always in cents — double-check before any Stripe API call
- Never do arithmetic on dollar strings

## Notification Jobs
- All scheduled notifications go through BullMQ in apps/worker
- Never call Twilio or Resend directly from apps/api request handlers
- On job failure: retry max 3x with exponential backoff, then mark as failed

## Credentials
- Twilio, Stripe, Resend, and DB credentials live in .env only
- Never hardcode keys, tokens, or connection strings in source files
- Validate all Twilio webhooks with signature verification before processing
