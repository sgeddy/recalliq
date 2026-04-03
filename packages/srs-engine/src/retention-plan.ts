import type { CertConfig } from "@recalliq/types";

// ---------------------------------------------------------------------------
// computeRetentionPlan
//
// Produces a personalized, research-backed study schedule given a cert's
// configuration and a user's available preparation time and daily capacity.
//
// Research basis:
//   - Cepeda et al. (2008): expanding intervals optimal; for fixed deadlines,
//     compress proportionally rather than switching to massed practice.
//   - Karpicke & Roediger (2007): 80%+ active recall (testing effect).
//   - Dobson (2012): expanding > uniform intervals for retention.
//   - Rohrer & Taylor (2007), Kornell & Bjork (2008): interleaved > blocked
//     for MCQ performance and transfer.
//   - Roediger/USF (2006): overlearning provides short-term hyper-stabilization.
//   - Watanabe (2017): 20min post-mastery protects against interference.
//   - Synchrony effect (May et al., Ryan et al.): study at chronotype peak.
// ---------------------------------------------------------------------------

export type Chronotype = "morning" | "evening" | "neutral";
export type PriorKnowledge = "none" | "basic" | "experienced";

export interface RetentionPlanInputs {
  // Weeks remaining before the exam. The single biggest driver of the plan shape.
  weeksUntilExam: number;
  // Minutes the user can commit to studying per day across all sessions.
  dailyStudyMinutes: number;
  // User's natural circadian rhythm — used to recommend study time-of-day.
  chronotype: Chronotype;
  // Prior familiarity with the subject matter.
  // "none" = starting from scratch, "basic" = some exposure, "experienced" = works in field.
  priorKnowledge: PriorKnowledge;
}

export interface StudyPhase {
  name: string;
  // Week numbers relative to start (1-indexed). endWeek is inclusive.
  startWeek: number;
  endWeek: number;
  durationDays: number;
  dailyNewCards: number;
  // Estimated reviews per day, accounting for SRS load buildup.
  estimatedDailyReviews: number;
  // Estimated total minutes per day including new cards + reviews.
  estimatedDailyMinutes: number;
  sessionsPerDay: number;
  sessionLengthMinutes: number;
  domainStrategy: "interleaved" | "weak-first" | "domain-by-domain";
  notes: string;
}

export interface MockExam {
  // Days before the exam this mock should be taken.
  daysBeforeExam: number;
  // Week number from start (for display).
  weekNumber: number;
  purpose: string;
}

export interface MaintenanceInterval {
  label: string;
  daysAfterExam: number;
  questionCount: number;
  sessionMinutes: number;
  purpose: string;
}

export interface MaintenancePlan {
  // Why maintenance matters — shown as the section rationale.
  rationale: string;
  intervals: MaintenanceInterval[];
}

export interface RetentionPlan {
  // Whether this plan is feasible given the inputs.
  feasible: boolean;
  // Explanation when feasible is false or the plan is compromised.
  feasibilityNote: string | null;
  // Warning when the schedule is compressed enough to compromise long-term retention.
  longTermRetentionNote: string | null;

  // Total target question pool size (from certConfig). Self-contained for display.
  totalPoolSize: number;
  // Percentage of pool this plan covers (0–100).
  coveragePercent: number;

  // Interval schedule selected based on weeksUntilExam.
  intervalSchedule: number[];
  // Human-readable label for the schedule tier.
  intervalScheduleLabel: string;

  // Number of unique questions this plan will cover (may be < questionPoolSize
  // if prep time is insufficient to cover the full pool).
  questionsCovered: number;
  // True if questionsCovered < certConfig.questionPoolSize.
  partialPoolCoverage: boolean;

  // Study phases in order.
  phases: StudyPhase[];

  // Full mock exam schedule.
  mockExams: MockExam[];

  // What to do in the final 72 hours.
  finalSprint: {
    sessionLengthMinutes: number;
    sessionsPerDay: number;
    focus: string;
    avoid: string;
  };

  // Time-of-day recommendation based on chronotype.
  // Research (synchrony effect): new material at circadian peak, reviews at trough.
  studyScheduleRecommendation: {
    newCardsTime: string;
    reviewTime: string;
    rationale: string;
  };

  // Post-exam maintenance schedule for career-long retention.
  maintenancePlan: MaintenancePlan;

  // Summary statistics.
  totalStudyHours: number;
  totalSessions: number;
  peakDailyMinutes: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Base minutes to study one new MCQ card (no prior knowledge): read question,
// evaluate all options, and review the explanation.
const BASE_MINUTES_PER_NEW_CARD = 3;
// Minutes per SRS review of a seen card (much faster — recognition, not first exposure).
const MINUTES_PER_REVIEW = 1.5;
// Average proportion of pool due for review on any given day at steady state.
// Derived from SRS load models: roughly 10-15% of active cards are due daily.
const DAILY_REVIEW_RATE = 0.12;

// Prior knowledge affects (a) how fast new cards are acquired and (b) how many
// repetitions are needed to cement each card. It does NOT change how many
// questions are covered — coverage is determined by the time window only, so
// that all users see the same exam-relevant material.
//
// Acquisition speed (minutes per new card):
//   "none"        → 3.0 min  (full read + all options + explanation review)
//   "basic"       → 2.25 min (some concepts click on first read, 25% faster)
//   "experienced" → 1.5 min  (recognition + gap-filling, 50% faster)
const MINUTES_PER_NEW_CARD_BY_KNOWLEDGE: Record<PriorKnowledge, number> = {
  none: BASE_MINUTES_PER_NEW_CARD,
  basic: 2.25,
  experienced: 1.5,
};

// Repetitions needed to reach mastery per card, by prior knowledge.
// Experienced learners already have existing memory traces — each review
// reinforces rather than builds from scratch, so fewer reps reach the same
// retention threshold. Research basis: SuperMemo data, Karpicke & Roediger (2007).
//   "none"        → 5 reps (full schedule, no prior traces)
//   "basic"       → 4 reps (some traces reduce one consolidation cycle)
//   "experienced" → 3 reps (strong traces, needs verification not construction)
const REPS_BY_KNOWLEDGE: Record<PriorKnowledge, number> = {
  none: 5,
  basic: 4,
  experienced: 3,
};

function selectIntervalSchedule(
  weeksUntilExam: number,
  config: CertConfig["retentionPlan"],
): { schedule: number[]; label: string } {
  if (weeksUntilExam >= 12) {
    return { schedule: config.intervalSchedules.fullPrep, label: "Full prep (12+ weeks)" };
  }
  if (weeksUntilExam >= 8) {
    return { schedule: config.intervalSchedules.standard, label: "Standard (8–11 weeks)" };
  }
  if (weeksUntilExam >= 4) {
    return { schedule: config.intervalSchedules.compressed, label: "Compressed (4–7 weeks)" };
  }
  return { schedule: config.intervalSchedules.emergency, label: "Emergency (2–3 weeks)" };
}

function chronotypeRecommendation(
  chronotype: Chronotype,
): RetentionPlan["studyScheduleRecommendation"] {
  // Research (synchrony effect, May et al. 1993, 2005; Ryan et al. 2002):
  // controlled analytical tasks (new material) benefit from circadian peaks.
  // Automatic/familiar tasks (reviews) can be done at off-peak times.
  switch (chronotype) {
    case "morning":
      return {
        newCardsTime: "7:00–9:00 AM",
        reviewTime: "7:00–9:00 PM",
        rationale:
          "Morning types encode new material best early in the day. Evening reviews take advantage of the pre-sleep consolidation window.",
      };
    case "evening":
      return {
        newCardsTime: "7:00–10:00 PM",
        reviewTime: "12:00–2:00 PM",
        rationale:
          "Evening types peak cognitively in the late evening. Pre-sleep study also leverages sleep consolidation — new material studied before sleep shows 30–40% better next-day retention.",
      };
    case "neutral":
      return {
        newCardsTime: "9:00–11:00 AM",
        reviewTime: "6:00–8:00 PM",
        rationale:
          "Mid-morning combines alertness with low cortisol stress. Evening review before sleep leverages consolidation during the subsequent sleep cycle.",
      };
  }
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

export function computeRetentionPlan(
  certConfig: CertConfig,
  inputs: RetentionPlanInputs,
): RetentionPlan {
  const { retentionPlan: cfg, questionPoolSize, durationMinutes: examDurationMinutes } = certConfig;
  const { weeksUntilExam, dailyStudyMinutes, chronotype, priorKnowledge } = inputs;

  // ── Step 1: Select interval schedule ──────────────────────────────────────
  const { schedule: intervalSchedule, label: intervalScheduleLabel } = selectIntervalSchedule(
    weeksUntilExam,
    cfg,
  );

  // ── Step 2: Compute daily new-card capacity ───────────────────────────────
  // Prior knowledge affects acquisition speed and review depth, not coverage.
  // Coverage (questionsCovered) is calculated from the baseline pace so that
  // all knowledge levels target the same exam-relevant question set given the
  // same time budget. This ensures hours decrease as experience increases.
  const minutesPerNewCard = MINUTES_PER_NEW_CARD_BY_KNOWLEDGE[priorKnowledge];
  const newCardMinutesPerDay = dailyStudyMinutes * cfg.activeRecallRatio;

  // Actual pace (used for phase display — how fast this user moves through cards).
  const rawNewCardsPerDay = Math.floor(newCardMinutesPerDay / minutesPerNewCard);
  const newCardsPerDay = Math.min(rawNewCardsPerDay, cfg.maxNewCardsPerSession);

  // Baseline pace (used for coverage calculation — same for everyone).
  const rawBaseNewCardsPerDay = Math.floor(newCardMinutesPerDay / BASE_MINUTES_PER_NEW_CARD);
  const baseNewCardsPerDay = Math.min(rawBaseNewCardsPerDay, cfg.maxNewCardsPerSession);

  // ── Step 3: Check feasibility ─────────────────────────────────────────────
  // Reserve time for: consolidation (≥2 weeks), mock exams (~1 week), final sprint (1 week).
  const reservedWeeks = 4; // minimum non-acquisition weeks
  const maxAcquisitionWeeks = Math.max(1, weeksUntilExam - reservedWeeks);
  const acquisitionDaysNeeded = Math.ceil(questionPoolSize / Math.max(1, newCardsPerDay));
  const acquisitionWeeksNeeded = Math.ceil(acquisitionDaysNeeded / 7);

  const feasible = weeksUntilExam >= cfg.minPrepWeeks;
  let feasibilityNote: string | null = null;

  if (!feasible) {
    feasibilityNote = `With only ${weeksUntilExam} week${weeksUntilExam === 1 ? "" : "s"} until your exam, full preparation is not possible. The minimum recommended window is ${cfg.minPrepWeeks} weeks. This plan maximizes your readiness given the time available — focus on high-weight domains and weak areas.`;
  }

  // ── Step 4: Compute covered question count ────────────────────────────────
  // Coverage uses baseline pace so that all knowledge levels get the same
  // questionsCovered for the same time budget. Experienced users reach this
  // coverage faster (more consolidation time), but see the same question set.
  const coverableDays = maxAcquisitionWeeks * 7;
  const questionsCovered = Math.min(questionPoolSize, coverableDays * baseNewCardsPerDay);
  const partialPoolCoverage = questionsCovered < questionPoolSize;

  if (partialPoolCoverage && feasible) {
    const coverPct = Math.round((questionsCovered / questionPoolSize) * 100);
    // Express the coverage gap in actionable terms the user can act on:
    // extra minutes/day needed, or weeks earlier to start.
    const neededBaseCardsPerDay = Math.ceil(questionPoolSize / (maxAcquisitionWeeks * 7));
    const minutesForFullCoverage = Math.ceil(
      (neededBaseCardsPerDay * BASE_MINUTES_PER_NEW_CARD) / cfg.activeRecallRatio,
    );
    const extraMinutesPerDay = minutesForFullCoverage - dailyStudyMinutes;
    const startEarlierWeeks = cfg.optimalPrepWeeks - weeksUntilExam;

    const actionHint =
      extraMinutesPerDay > 0 && startEarlierWeeks > 0
        ? `Study ${extraMinutesPerDay} more minutes per day, or start ${startEarlierWeeks} weeks earlier.`
        : extraMinutesPerDay > 0
          ? `Study ${extraMinutesPerDay} more minutes per day to reach full coverage.`
          : `Start ${startEarlierWeeks} weeks earlier to reach full coverage.`;

    feasibilityNote = `At ${dailyStudyMinutes} min/day over ${weeksUntilExam} weeks, this plan covers ${questionsCovered} of ${questionPoolSize} exam questions (${coverPct}%). ${actionHint}`;
  }

  // ── Long-term retention note ───────────────────────────────────────────────
  let longTermRetentionNote: string | null = null;
  if (weeksUntilExam <= cfg.minPrepWeeks && priorKnowledge === "none") {
    longTermRetentionNote = `Compressed prep with no prior background optimizes for exam day but not long-term retention. Research shows 40–60% of material learned this quickly is forgotten within 3 months without reinforcement. The maintenance program below is strongly recommended.`;
  } else if (weeksUntilExam < 8) {
    longTermRetentionNote = `This schedule is built for your exam date. For career-lasting retention — interviews, promotions, daily practice — the post-exam maintenance program below maintains 80%+ recall at a fraction of the original study time.`;
  }

  // ── Step 6: Build phases ──────────────────────────────────────────────────
  const actualAcquisitionWeeks = Math.min(acquisitionWeeksNeeded, maxAcquisitionWeeks);

  // Mock exam weeks: schedule mocks in the last portion of prep.
  // Use the last N candidates (closest to exam day).
  const activeMockDays = cfg.mockExamDayCandidates
    .filter((d) => d < weeksUntilExam * 7)
    .slice(-cfg.recommendedMockExams);

  const mockExamWeeks = activeMockDays.length > 0 ? Math.ceil((activeMockDays[0] ?? 7) / 7) + 1 : 2;

  // Consolidation fills the gap between acquisition end and mock phase start.
  const consolidationWeeks = Math.max(
    1,
    weeksUntilExam - actualAcquisitionWeeks - mockExamWeeks - 1, // -1 for final sprint
  );

  const finalSprintWeeks = 1; // last 3-7 days, treated as 1 week block

  const phases: StudyPhase[] = [];

  // Phase 1 — Acquisition
  if (actualAcquisitionWeeks > 0 && newCardsPerDay > 0) {
    const reviewsPerDay = Math.round(questionsCovered * DAILY_REVIEW_RATE * 0.5); // ramp up
    const reviewMinutes = reviewsPerDay * MINUTES_PER_REVIEW;
    const newCardMinutes = newCardsPerDay * minutesPerNewCard;
    const totalMinutesPerDay = newCardMinutes + reviewMinutes;
    const sessionsPerDay = totalMinutesPerDay > cfg.sessionLengthMinutes ? 2 : 1;

    phases.push({
      name: "Acquisition",
      startWeek: 1,
      endWeek: actualAcquisitionWeeks,
      durationDays: actualAcquisitionWeeks * 7,
      dailyNewCards: newCardsPerDay,
      estimatedDailyReviews: reviewsPerDay,
      estimatedDailyMinutes: Math.round(totalMinutesPerDay),
      sessionsPerDay,
      sessionLengthMinutes: Math.min(
        cfg.sessionLengthMinutes,
        Math.ceil(totalMinutesPerDay / sessionsPerDay),
      ),
      domainStrategy: cfg.interleaveDomains ? "interleaved" : "domain-by-domain",
      notes:
        `Introduce ${newCardsPerDay} new cards per day across all ${certConfig.domains.length} domains in proportion to their exam weight. ` +
        `Domain weights drive card distribution: heavier domains get more cards per session. ` +
        `Review load is low early — rises to ~${Math.round(questionsCovered * DAILY_REVIEW_RATE)} cards/day by the end of this phase.`,
    });
  }

  // Phase 2 — Consolidation
  if (consolidationWeeks > 0) {
    const consolidationStart = actualAcquisitionWeeks + 1;
    const peakReviewsPerDay = Math.round(questionsCovered * DAILY_REVIEW_RATE);
    const reviewMinutes = peakReviewsPerDay * MINUTES_PER_REVIEW;
    const sessionsPerDay = reviewMinutes > cfg.sessionLengthMinutes ? 2 : 1;

    phases.push({
      name: "Consolidation",
      startWeek: consolidationStart,
      endWeek: consolidationStart + consolidationWeeks - 1,
      durationDays: consolidationWeeks * 7,
      dailyNewCards: 0,
      estimatedDailyReviews: peakReviewsPerDay,
      estimatedDailyMinutes: Math.round(reviewMinutes),
      sessionsPerDay,
      sessionLengthMinutes: Math.min(
        cfg.sessionLengthMinutes,
        Math.ceil(reviewMinutes / sessionsPerDay),
      ),
      domainStrategy: "interleaved",
      notes:
        `No new cards. Pure SRS review — the algorithm surfaces cards at their forgetting threshold. ` +
        `Review burden peaks at ~${peakReviewsPerDay} cards/day. ` +
        `Weak cards (those reset to interval index 1 after failure) get shorter intervals and will appear more frequently. ` +
        `This phase builds the discriminative knowledge needed to distinguish near-miss wrong answers — critical for MCQ exams.`,
    });
  }

  // Phase 3 — Mock Exam Prep
  if (mockExamWeeks > 0) {
    const mockStart = actualAcquisitionWeeks + consolidationWeeks + 1;
    const peakReviewsPerDay = Math.round(questionsCovered * DAILY_REVIEW_RATE * 1.1); // slightly elevated
    const reviewMinutes = peakReviewsPerDay * MINUTES_PER_REVIEW;
    const mockExamDayMinutes = examDurationMinutes + 30; // exam time + review session after

    phases.push({
      name: "Mock Exam & Weak-Spot Targeting",
      startWeek: mockStart,
      endWeek: mockStart + mockExamWeeks - 1,
      durationDays: mockExamWeeks * 7,
      dailyNewCards: 0,
      estimatedDailyReviews: peakReviewsPerDay,
      estimatedDailyMinutes: Math.round((reviewMinutes + mockExamDayMinutes) / 7), // avg incl mock days
      sessionsPerDay: 1,
      sessionLengthMinutes: cfg.sessionLengthMinutes,
      domainStrategy: "weak-first",
      notes:
        `Take full ${examDurationMinutes}-minute timed mock exams on scheduled days. ` +
        `After each mock: log incorrect questions and create a targeted weak-spot review queue. ` +
        `Between mocks: SRS reviews continue normally — the algorithm will naturally surface weak items more. ` +
        `Timed practice under exam conditions builds the pacing intuition needed for performance-based questions.`,
    });
  }

  // Phase 4 — Final Sprint (last 3 days)
  const finalSprintStart = weeksUntilExam - finalSprintWeeks + 1;
  phases.push({
    name: "Final Sprint",
    startWeek: finalSprintStart,
    endWeek: weeksUntilExam,
    durationDays: 3,
    dailyNewCards: 0,
    estimatedDailyReviews: Math.round(questionsCovered * 0.05), // light — only flagged weak cards
    estimatedDailyMinutes: cfg.finalSprintSessionMinutes * cfg.finalSprintSessionsPerDay,
    sessionsPerDay: cfg.finalSprintSessionsPerDay,
    sessionLengthMinutes: cfg.finalSprintSessionMinutes,
    domainStrategy: "weak-first",
    notes:
      `${cfg.finalSprintSessionMinutes}-minute light recall bursts only. No new material. ` +
      `Review only cards flagged as weak (failed in last 2 weeks). ` +
      `Prioritize sleep (7–9 hours) over additional study — memory consolidation requires it. ` +
      `Research: studying the night before can impair performance via interference with sleep-phase consolidation.`,
  });

  // ── Step 7: Build mock exam schedule ─────────────────────────────────────
  const mockExams: MockExam[] = activeMockDays.map((daysBeforeExam, i) => ({
    daysBeforeExam,
    weekNumber: weeksUntilExam - Math.floor(daysBeforeExam / 7),
    purpose:
      i === 0
        ? "Diagnostic — identify domains and question types where you're losing points. Use results to reprioritize review queue."
        : i === activeMockDays.length - 1
          ? "Final readiness check — simulate exam day conditions exactly. Review wrong answers only; no extended study after."
          : "Mid-prep checkpoint — measure improvement since first mock. Adjust weak-spot queue accordingly.",
  }));

  // ── Step 8: Compute summary stats ─────────────────────────────────────────
  // Experienced learners need fewer repetitions per card — existing memory traces
  // mean each review reinforces rather than constructs from scratch.
  const effectiveReps = REPS_BY_KNOWLEDGE[priorKnowledge];
  const totalRepetitions = questionsCovered * effectiveReps;
  const totalNewCardMinutes = questionsCovered * minutesPerNewCard;
  const totalReviewMinutes = totalRepetitions * MINUTES_PER_REVIEW;
  const mockExamMinutes = activeMockDays.length * (examDurationMinutes + 30);
  const bufferMultiplier = 1.2; // 20% buffer for re-reviews, pauses, transitions
  const totalStudyMinutes =
    (totalNewCardMinutes + totalReviewMinutes + mockExamMinutes) * bufferMultiplier;
  const totalStudyHours = Math.round((totalStudyMinutes / 60) * 10) / 10;

  const totalSessions = phases.reduce((sum, p) => sum + p.durationDays * p.sessionsPerDay, 0);

  const peakPhase = phases.reduce((max, p) =>
    p.estimatedDailyMinutes > max.estimatedDailyMinutes ? p : max,
  );

  // ── Step 9: Build maintenance plan ───────────────────────────────────────
  // Intervals scale with pool size but are capped to keep sessions short.
  const maintenancePlan: MaintenancePlan = {
    rationale:
      "The forgetting curve doesn't stop at exam day. Periodic recall checks rebuild memory traces before they fully decay — maintaining career-grade retention at 5–10% of the original prep time. This keeps the knowledge sharp for interviews, promotions, and daily practice.",
    intervals: [
      {
        label: "1 month",
        daysAfterExam: 30,
        questionCount: Math.max(15, Math.round(questionPoolSize * 0.05)),
        sessionMinutes: 30,
        purpose:
          "First major forgetting inflection point. Catch concepts that didn't fully consolidate before they're gone.",
      },
      {
        label: "3 months",
        daysAfterExam: 90,
        questionCount: Math.max(20, Math.round(questionPoolSize * 0.075)),
        sessionMinutes: 45,
        purpose:
          "Verify medium-term retention. Concepts surviving this check have strong enough traces for reliable interview recall.",
      },
      {
        label: "6 months",
        daysAfterExam: 180,
        questionCount: Math.max(20, Math.round(questionPoolSize * 0.075)),
        sessionMinutes: 45,
        purpose:
          "Semi-annual audit. Surfaces knowledge gaps before your next career milestone or role transition.",
      },
      {
        label: "1 year",
        daysAfterExam: 365,
        questionCount: Math.max(30, Math.round(questionPoolSize * 0.125)),
        sessionMinutes: 60,
        purpose:
          "Annual certification audit. Passing this demonstrates long-term mastery — not just exam-day recall.",
      },
    ],
  };

  const coveragePercent = Math.round((questionsCovered / questionPoolSize) * 100);

  return {
    feasible,
    feasibilityNote,
    longTermRetentionNote,
    totalPoolSize: questionPoolSize,
    coveragePercent,
    intervalSchedule,
    intervalScheduleLabel,
    questionsCovered,
    partialPoolCoverage,
    phases,
    mockExams,
    finalSprint: {
      sessionLengthMinutes: cfg.finalSprintSessionMinutes,
      sessionsPerDay: cfg.finalSprintSessionsPerDay,
      focus: "Light active recall on weak cards only. No new material.",
      avoid:
        "Cramming, long sessions, new topics, late nights. Sleep is your highest-leverage activity in the final 72 hours.",
    },
    studyScheduleRecommendation: chronotypeRecommendation(chronotype),
    maintenancePlan,
    totalStudyHours,
    totalSessions: Math.round(totalSessions),
    peakDailyMinutes: peakPhase.estimatedDailyMinutes,
  };
}
