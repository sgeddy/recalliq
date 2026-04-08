# RecallIQ Feature Backlog

Tracked here for planning. Not yet implemented.

---

## FEAT-001: Exam Date + Countdown

**What:** Users can set their target exam date when enrolling in a certification course. Once set, a countdown is displayed throughout the app.

**Where it shows:**

- Enrollment flow: optional exam date picker
- Course detail page: "X days to your exam"
- Session page header: compact countdown badge
- Email notifications: countdown included in review reminders as urgency signal

**Behavior:**

- Exam date is stored on the enrollment record (`examDate` column)
- Countdown recalculates client-side daily
- If exam date is within 14 days: visual urgency treatment (amber badge)
- If exam date is within 7 days: red badge + increased review frequency (compress intervals)
- After exam date passes: trigger the Post-Exam Email flow (FEAT-003)
- Users can update the exam date at any time from the enrollment settings

**DB change needed:** `ALTER TABLE enrollments ADD COLUMN exam_date DATE;`

---

## FEAT-002: Preparedness Score

**What:** A 0–100% score that reflects how ready the user is to pass the exam. It is NOT a simple correct/incorrect ratio — it accounts for spaced repetition consistency, domain coverage, and time-distributed recall.

### Design Principles

- **One correct answer ≠ preparedness.** A card answered correctly once at interval index 0 contributes almost nothing.
- **Repeated correct answers over time = confidence.** A card consistently passed at interval index 4+ (25+ days since last review) signals durable retention.
- **Domain weighting is mandatory.** The score is weighted by the exam's official domain percentages. Excelling in a 12%-weight domain while failing a 28%-weight domain must reflect poorly on the score.
- **Recency matters.** A card not yet due for review should decay slightly in its confidence contribution over time if not revisited. Knowledge fades.

### Algorithm (proposed)

**Per-card confidence score (0–1):**

```
intervalWeight = intervalIndex / maxIntervalIndex   // normalized: 0 = first pass, 1 = long-term
passRate       = correctAnswers / totalAttempts     // over ALL attempts on this card
recencyFactor  = f(daysSinceLastReview, currentInterval)  // 1.0 if reviewed recently, decays toward 0
cardScore      = intervalWeight * passRate * recencyFactor
```

**Per-domain score:**

```
domainScore = mean(cardScore) for all cards in domain
```

**Overall preparedness score:**

```
score = sum(domainScore[d] * domainWeight[d]) for each domain d
```

Where `domainWeight[d]` is the official exam domain percentage (e.g., 0.28 for Security Operations).

**Thresholds:**

- 0–49%: Beginner — not enough practice yet
- 50–74%: Building — making progress, keep going
- 75–89%: Solid — close but not ready to bank on it
- 90–100%: Exam-ready — high confidence to pass

### Exam Date + Score Integration

If the user has set an exam date AND their score is below 90% within 14 days of the exam:

- Show an in-app warning recommending they consider rescheduling
- "Your preparedness score is X%. Most users who pass score above 90% before exam day. Consider pushing your date back to allow more time."

**DB changes needed:**

- Track `totalAttempts`, `correctAttempts` per review_event (or derive from review history)
- Possibly add a `preparedness_snapshots` table for historical score tracking

---

## FEAT-003: Post-Exam Email + Outcome Tracking

**What:** Automatically send an email after the user's exam date to collect outcome data. This data drives individual curriculum adjustments, aggregate marketing proof, and platform improvement.

### Trigger

Worker job scheduled for exam date + 1 day (configurable). Enqueued when `examDate` is set on the enrollment.

### Email Content

Subject: "How did your [Exam Name] exam go?"

Body:

- Warm congratulations on taking the exam
- Simple single-question CTA: "How did you do?"
- Three options (tracked link or short form):
  - ✅ I passed! — redirects to success flow
  - ❌ I didn't pass this time — redirects to retry flow
  - ⏳ Still waiting for results — triggers a follow-up email in 7 days

### Outcome Flows

**If passed:**

- Congratulations page with shareable badge/result
- NPS / testimonial prompt: "Would you recommend RecallIQ to others?"
- Option to share result on LinkedIn (future)
- Data stored: passed=true, score (optional), testimonialtxt (optional)
- Marketing use: pass rate proof, featured testimonials

**If failed:**

- Empathetic message: "Most people don't pass on the first try — that's normal."
- Prompt to re-enroll or continue existing subscription
- Curriculum adjustment: increase frequency on failed domains
  - If user shares which domains they struggled with, auto-adjust interval weights for those domains
- Data stored: passed=false, self-reported weak domains
- Platform use: flag content gaps, improve question bank for those topics

**If still waiting:**

- Follow-up email after 7 days
- Same flow as above once result is known

### Data Model

```
exam_outcomes table:
  id, enrollment_id, passed (boolean|null), self_reported_score (int|null),
  weak_domains (text[]|null), testimonial (text|null), nps_score (int|null),
  responded_at, created_at
```

### Marketing + Platform Intelligence Uses

- **Pass rate by course:** "87% of RecallIQ users who reach 90% preparedness pass on their first attempt"
- **Time to ready:** Average days from enrollment to 90% preparedness score
- **Curriculum signal:** Aggregate failed domains → flag weak practice questions for that topic
- **Retake curriculum:** If user failed, auto-adjust their next session to focus on reported weak areas before returning to normal SRS schedule

---

## FEAT-004: Cert Expiration Tracking + Recertification Flow

**What:** After a user passes their exam (via FEAT-003 outcome tracking), RecallIQ tracks the certification's expiration date and re-engages them ahead of time to begin recertification prep. The goal is to keep the user subscribed and certified long-term — the relationship doesn't end at the first pass.

**Cert expiration data:**

- Expiration window is stored per course (e.g., Security+ = 3 years from pass date)
- `certExpiresAt` is derived from `exam_outcomes.responded_at` + the course's `certValidityYears` field
- New column needed: `courses.cert_validity_years INTEGER` (nullable — not all courses are certs)

**Re-engagement timeline (example: 3-year cert):**

| Time since passing      | Action                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| 2 years                 | Email check-in: "Your Security+ expires in 1 year. Want to get ahead of it?" |
| 2 years (no response)   | Follow-up after 30 days with softer prompt                                   |
| 2.5 years               | Second check-in: ask user to choose a recert start preference                |
| 2.5 years (no response) | Auto-schedule recert prep to begin at 3 months before expiry                 |
| 3 years - 3 months      | Begin recertification refresh session sequence if user hasn't started        |

**User preference options (collected at 2.5-year check-in):**

- Start refresh training now
- Remind me at 3 months before expiry (auto-scheduled)
- I'm not renewing this cert

**Recertification prep behavior:**

- Refresh sessions prioritize cards the user historically answered incorrectly or with low interval depth
- Domain weights are re-applied — if the exam domain percentages changed between versions, new cards are inserted for updated objectives
- Shortened interval schedule for refresh (faster ramp since foundation exists): e.g., `[0, 1, 3, 7, 14, 30]` instead of the standard schedule
- Preparedness score (FEAT-002) is reset and re-calculated for the recert cycle

**Notification jobs:**

- Three scheduled BullMQ jobs enqueued when `exam_outcomes.passed = true`:
  1. `cert-checkin-2yr-${enrollmentId}` — fires at `certExpiresAt - 1yr`
  2. `cert-checkin-2-5yr-${enrollmentId}` — fires at `certExpiresAt - 6mo`
  3. `cert-final-${enrollmentId}` — fires at `certExpiresAt - 3mo` (only if user hasn't re-enrolled)
- Jobs are cancelled if user re-enrolls in the recert course before the trigger date

**In-app surface:**

- Dashboard badge: "Your Security+ expires [date] — [X months away]"
- Settings > Certifications: list of all earned certs with expiry dates and recert status
- Clicking "Start recertification" re-enrolls user in the course with a `recert: true` flag, triggering the compressed interval schedule

**DB changes needed:**

- `courses`: add `cert_validity_years INTEGER` (nullable)
- `exam_outcomes`: `cert_expires_at DATE` (derived on write from passed date + validity years)
- `enrollments`: add `is_recert BOOLEAN DEFAULT false` to drive interval selection
- New `recert_preferences` table or extend `exam_outcomes`:
  - `recert_preference ENUM('start_now', 'remind_later', 'not_renewing') | null`
  - `recert_preference_set_at TIMESTAMP`

---

## FEAT-005: AI Curriculum Builder (Content Upload → SRS Course)

**What:** Users upload their own knowledge content (PDFs, docs, notes, slide decks) and the app uses AI to parse it, extract key concepts, generate flashcard-style questions, organize them into a domain/module structure, and produce a personalized SRS memorization schedule following spaced repetition best practices.

**Why this matters:** Unlocks RecallIQ for any learning goal — not just CompTIA exams. A user studying for the bar exam, a medical licensing test, or internal company training can bring their own material and get the same SRS-powered retention engine.

**Core flow:**

1. User uploads one or more files (PDF, DOCX, TXT, MD) or pastes raw text
2. AI (Claude) extracts key concepts, facts, and testable ideas
3. AI generates question/answer pairs (front/back) with explanations
4. AI groups cards into logical domains/modules with suggested weightings
5. User reviews the generated curriculum before publishing (edit, delete, reorder cards)
6. On confirm: course + modules + cards written to DB; SRS schedule initialized for that enrollment

**AI responsibilities:**

- Identify what is worth memorizing vs. what is context/filler
- Generate questions at the right granularity (not too broad, not trivia)
- Assign domain groupings based on topic clustering
- Surface domain weight suggestions (equal weight as default if no exam framework is known)
- Estimate difficulty per card (beginner/intermediate/advanced)

**Upload constraints (initial scope):**

- Max 3 files per curriculum, max 20MB each
- Supported formats: PDF, DOCX, TXT, MD
- Processing happens async (BullMQ job) — user gets notified when ready

**DB changes needed:**

- `courses`: add `is_user_generated BOOLEAN DEFAULT false`, `owner_user_id TEXT` (nullable — null = platform-owned)
- `modules`: no change needed
- `cards`: add `ai_generated BOOLEAN DEFAULT false`, `source_excerpt TEXT` (optional — snippet of source text that generated this card)
- New `curriculum_uploads` table: `id, user_id, course_id (nullable until processed), file_name, file_url, status ENUM('pending','processing','done','failed'), created_at`

**Open questions:**

- Do user-generated courses appear in the public course catalog or stay private?
- Can users share their generated curricula with others?
- Rate limiting: how many curricula can a user generate per billing period?
- Copyright / IP considerations for uploaded content

---

## Completed (not in backlog)

- Mock exam sessions — full state machine, domain-weighted questions, scaled scoring, domain breakdown, review mode ✓
- Voice review sessions — Twilio Conversation Relay + ElevenLabs TTS + Claude Haiku AI agent ✓
- Post-exam follow-up email + maintenance reminder jobs ✓
- 288-question practice bank (Professor Messer SY0-701, transformed) ✓

## Future / Out-of-Scope for Now

- PBQ (performance-based question) support — noted in exam research, deferred
- LinkedIn result sharing badge
- Group/team enrollments (corporate training)
- Leaderboards / social features
- SMS review reminders (Twilio SMS, already scaffolded — needs phone number collection UI)
- **Mobile app** — native iOS/Android for full mobile-first study experience (push notifications, offline sessions, home screen access). Web app will remain the foundation; mobile wraps or extends it. Defer until web is stable and user base justifies the investment.
