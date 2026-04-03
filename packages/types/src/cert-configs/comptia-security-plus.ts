import type { CertConfig } from "../cert-config.js";

export const comptiaSecurityPlus: CertConfig = {
  // ── Identity ───────────────────────────────────────────────────────────────
  slug: "comptia-security-plus",
  examCode: "SY0-701",
  officialTitle: "CompTIA Security+",
  certificationBody: "CompTIA",
  isVendorNeutral: true,
  vendorName: null,

  // ── Exam logistics ─────────────────────────────────────────────────────────
  maxQuestions: 90,
  typicalQuestionCount: 80,
  questionTypes: ["mcq", "pbq"],
  approximatePbqCount: 5,
  durationMinutes: 90,
  passingScore: {
    scaled: 750,
    scaleMax: 900,
    scaleMin: 100,
    percentage: null,
  },
  examCostUsd: 404,
  retakePolicy: {
    firstAttemptWaitDays: 0,
    subsequentWaitDays: 14,
    maxAttemptsPerYear: null,
    canRetakeAfterPass: false,
  },
  deliveryMethods: ["in-center", "online-proctored"],
  testingVendors: ["Pearson VUE"],
  languagesAvailable: ["en", "ja", "zh-Hans", "zh-Hant"],

  // ── Cert lifecycle ─────────────────────────────────────────────────────────
  certValidityYears: 3,
  renewalConfig: {
    method: "ceu",
    windowMonthsBefore: 12,
    creditRequiredPerCycle: 50,
    creditCycleYears: 3,
    annualMaintenanceFeeUsd: null,
    freeAssessmentAvailable: false,
  },
  currentVersionCode: "SY0-701",
  currentVersionReleaseDate: "2023-11-07",
  currentVersionRetirementDate: null,

  // ── Prerequisites ──────────────────────────────────────────────────────────
  formalPrerequisites: false,
  recommendedExperienceMonths: 24,
  recommendedPriorCerts: ["comptia-network-plus"],
  requiredTrainingHours: null,

  // ── Classification ─────────────────────────────────────────────────────────
  level: "associate",
  specialization: "cybersecurity",
  specialtyArea: null,
  industrySectors: ["government", "defense", "finance", "healthcare", "technology"],
  jobRoles: [
    "Security Analyst",
    "SOC Analyst",
    "Security Engineer",
    "Systems Administrator",
    "IT Auditor",
    "Junior Penetration Tester",
    "Network Administrator",
    "Help Desk / Tier 2 Support",
  ],
  certFamilyName: "CompTIA Security Path",
  certFamilyPosition: 2,

  // ── Domains ────────────────────────────────────────────────────────────────
  domains: [
    { name: "General Security Concepts", weightPercent: 12 },
    { name: "Threats, Vulnerabilities and Mitigations", weightPercent: 22 },
    { name: "Security Architecture", weightPercent: 18 },
    { name: "Security Operations", weightPercent: 28 },
    { name: "Security Program Management and Oversight", weightPercent: 20 },
  ],
  adaptiveTesting: false,

  // ── Compliance / recognition ───────────────────────────────────────────────
  dod8570Categories: [
    "IAT-II",
    "IAM-I",
    "IASAE-I",
    "CSSP-Analyst",
    "CSSP-Infrastructure",
    "CSSP-Incident-Responder",
    "CSSP-Auditor",
  ],
  dod8140Categories: ["IAT-II", "IAM-I"],
  iso17024Accredited: true,
  ansiAccredited: true,
  governmentRecognition: ["DoD 8570.01-M", "DoD 8140", "NIST"],

  // ── Retention plan ─────────────────────────────────────────────────────────
  // Current practice bank size — 288 transformed MCQ questions from Professor Messer
  // SY0-701 practice exams (3 exams × ~85 questions, deduplicated and transformed).
  questionPoolSize: 288,

  retentionPlan: {
    // Target 90% recall probability at each review — FSRS default, research-validated
    // for high-stakes exam prep. Higher (e.g. 0.95) requires ~30% more reviews.
    targetRetentionRate: 0.9,

    // 5 successful recalls per card before "mastered" status.
    // Research: 5-7 reps for reliable long-term retention (SuperMemo data,
    // Karpicke & Roediger 2007). Index 0 = initial learning session (day 0),
    // so 5 reps = indices 0→1→2→3→4→5 across the interval schedule.
    targetRepetitionsPerCard: 5,

    // Research minimum: 4 weeks for a 288-question pool at a sustainable pace.
    minPrepWeeks: 4,

    // Research optimal: 12 weeks allows full expanding intervals with peak retention.
    // Cepeda et al. (2008): for 1-year retention goals, gaps of ~10% of the target
    // interval are optimal — 12 weeks enables this across the full 365-day schedule.
    optimalPrepWeeks: 12,

    intervalSchedules: {
      // 12+ weeks: full Ebbinghaus expanding schedule.
      // Same-day → 1d → 4d → 10d → 25d → 60d → 150d → 1yr then doubling.
      fullPrep: [0, 1, 4, 10, 25, 60, 150, 365],

      // 8-11 weeks: moderate compression. Maintains the doubling principle
      // but compresses early intervals to fit within the window.
      standard: [0, 1, 3, 7, 14, 30, 60],

      // 4-7 weeks: compressed. Based on the "2357 method" (review at 2, 3, 5, 7
      // days before exam) adapted for forward-planning. Shorter early gaps mean
      // more review burden but still captures the spacing benefit.
      compressed: [0, 1, 2, 5, 10, 21],

      // 2-3 weeks: emergency compression. Partial spacing still beats massed
      // practice — research shows 20-50% better retention than single-session cram.
      emergency: [0, 1, 2, 4, 7, 14],
    },

    // 45-minute sessions: within the research-supported 25-60 min window.
    // Allows one session in a lunch break or two sessions per day comfortably.
    sessionLengthMinutes: 45,

    // 25 new cards/session ceiling. Above this, working memory load degrades
    // consolidation. Equates to ~75 min of new-card time (3 min/card average
    // for MCQ: read, evaluate options, review explanation).
    maxNewCardsPerSession: 25,

    // 80% active recall. Research (testing effect, Roediger & Karpicke 2006):
    // retrieval practice yields 50% better 1-week retention than re-reading.
    // Remaining 20% = reviewing explanations for missed questions.
    activeRecallRatio: 0.8,

    // Interleave all 5 domains in every session.
    // Research (Rohrer & Taylor 2007, Kornell & Bjork 2008): interleaved > blocked
    // for MCQ performance and transfer. Forces discrimination between similar concepts
    // — especially important in Security+ where domains have overlapping terminology.
    interleaveDomains: true,

    // Continue drilling mastered cards.
    // Research (Watanabe 2017, USF Roediger 2006): 20min post-mastery overlearning
    // provides hyper-stabilization against interference from new learning.
    // Especially valuable in the 2 weeks before the exam.
    overlearningEnabled: true,

    // 3 full mock exams: enough to identify patterns without exam fatigue.
    // Research consensus: 3-5 mocks total, last 1-2 in the final week.
    recommendedMockExams: 3,

    // Candidate days for mock exams (descending — algorithm picks the last N).
    // Research: day 7 and day 3 are the two highest-value mock windows.
    // Day 21 adds an early diagnostic for candidates with 8+ weeks of prep.
    mockExamDayCandidates: [21, 14, 7, 3],

    // Final 3 days: two 20-minute light recall bursts per day.
    // Research: short spaced bursts > sustained study; no new material; sleep > studying.
    finalSprintSessionMinutes: 20,
    finalSprintSessionsPerDay: 2,
  },

  // ── SRS shortcuts (used by existing scheduler, derived from retentionPlan) ─
  defaultIntervals: [0, 1, 4, 10, 25, 60, 150, 365],
  recertIntervals: [0, 1, 3, 7, 14, 30, 60],
  recommendedStudyHours: 60,

  // ── Market data ────────────────────────────────────────────────────────────
  averageSalaryUsd: 97000,
  officialExamPageUrl: "https://www.comptia.org/en-us/certifications/security/",
  officialObjectivesUrl:
    "https://partners.comptia.org/docs/default-source/resources/security-sy0-701-exam-objectives-(5-0)",
};
