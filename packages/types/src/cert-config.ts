// ---------------------------------------------------------------------------
// CertConfig — structured metadata for a certification exam course.
//
// One config file per cert (e.g., cert-configs/comptia-security-plus.ts).
// The slug must match courses.slug in the database.
//
// Fields are grouped by the platform feature they drive:
//   - Exam logistics      → course detail page UI
//   - Cert lifecycle      → FEAT-004 recertification workflow
//   - Prerequisites       → onboarding recommendations
//   - Classification      → discovery, filtering, search
//   - Domains             → FEAT-002 preparedness score domain weighting
//   - Compliance          → employer / government value prop
//   - Retention plan      → SRS scheduling engine + study plan generator
//   - Market data         → marketing, conversion copy
// ---------------------------------------------------------------------------

export type CertLevel =
  | "foundational" // entry-level, no experience required (CompTIA Tech+, AWS Cloud Practitioner)
  | "associate" // 1-2 years experience (CompTIA Security+, AWS SAA)
  | "professional" // 3-5 years experience (CISSP, PMP, AWS SAP)
  | "expert" // 5+ years, senior practitioners (CASP+, Azure Expert)
  | "specialist"; // deep specialization within a domain (AWS Specialty certs)

// How the certification is renewed when it expires.
export type RenewalMethod =
  | "exam-retake" // Pass the exam again (AWS default, CompTIA option)
  | "ceu" // CompTIA CE program — 50 CEUs over 3 years
  | "cpe" // ISC2 CPE credits — 120 over 3 years (Group A + B)
  | "pdu" // PMI PDUs — 60 over 3 years
  | "ece" // EC-Council ECE credits — 120 over 3 years
  | "free-assessment" // Microsoft free online renewal assessment
  | "maintenance-module" // Salesforce trailhead modules (3 per year per release)
  | "none"; // Cert never expires (some legacy certs)

// DoD 8570 / 8140 job role categories.
// Used to flag which certs qualify users for government/defense positions.
export type DodCategory =
  | "IAT-I"
  | "IAT-II"
  | "IAT-III"
  | "IAM-I"
  | "IAM-II"
  | "IAM-III"
  | "IASAE-I"
  | "IASAE-II"
  | "IASAE-III"
  | "CSSP-Analyst"
  | "CSSP-Infrastructure"
  | "CSSP-Incident-Responder"
  | "CSSP-Auditor"
  | "CSSP-Manager";

export interface ExamDomain {
  name: string;
  weightPercent: number; // integer, 0–100; all domains must sum to 100
}

// Passing score representation — supports both scaled (CompTIA, AWS, Microsoft)
// and percentage-based (Google Cloud, Salesforce) scoring systems.
export interface PassingScore {
  scaled: number; // e.g., 750
  scaleMax: number; // e.g., 900
  scaleMin: number; // e.g., 100
  percentage: number | null; // e.g., 75 — null if only scaled score is published
}

export interface RetakePolicy {
  firstAttemptWaitDays: number; // wait before 2nd attempt (0 = immediate)
  subsequentWaitDays: number; // wait before 3rd+ attempt
  maxAttemptsPerYear: number | null; // null = no published limit
  canRetakeAfterPass: boolean; // whether passed holders can retake (rare)
}

// Recertification / renewal configuration.
// Drives FEAT-004: when to send check-in emails, what action to request.
export interface RenewalConfig {
  method: RenewalMethod;
  // How many months before expiry the renewal window opens.
  windowMonthsBefore: number;
  // For CEU/CPE/PDU/ECE methods: total credits required per renewal cycle.
  creditRequiredPerCycle: number | null;
  creditCycleYears: number | null;
  // Annual membership fee for credential maintenance (ISC2, EC-Council).
  annualMaintenanceFeeUsd: number | null;
  // Whether a free online renewal option exists (Microsoft, some Salesforce).
  freeAssessmentAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Retention Plan Configuration
//
// Per-cert parameters that drive the study plan algorithm in srs-engine.
// Research basis noted inline. See computeRetentionPlan() for the algorithm.
// ---------------------------------------------------------------------------

// Interval schedules keyed by available preparation window.
// Research (Cepeda 2008, Dobson 2012): expanding intervals outperform uniform;
// for fixed deadlines, compress proportionally rather than switching to massed.
export interface IntervalSchedules {
  // 12+ weeks: full Ebbinghaus expanding schedule — maximum long-term retention.
  fullPrep: number[];
  // 8-11 weeks: moderate compression — maintains doubling pattern, viable for most.
  standard: number[];
  // 4-7 weeks: compressed schedule — reverse-planned from exam date (2357 method).
  compressed: number[];
  // 2-3 weeks: emergency compression — partial spacing beats pure cramming.
  emergency: number[];
}

export interface RetentionPlanConfig {
  // ── Retention targets ────────────────────────────────────────────────────
  // Target recall probability at review time. Research: 0.90 for exam prep.
  // FSRS default is 0.90; higher requires more frequent reviews.
  targetRetentionRate: number;

  // Successful recall repetitions required before a card is "mastered".
  // Research (SuperMemo data, Roediger/Karpicke 2006): 5-7 reps for 90%+
  // long-term retention. Overlearning beyond this has diminishing returns
  // but short-term (20min post-mastery) protects against interference.
  targetRepetitionsPerCard: number;

  // ── Preparation windows ──────────────────────────────────────────────────
  // Minimum weeks to cover the full question pool with adequate spacing.
  // Research: 4 weeks minimum for a 400-question pool.
  minPrepWeeks: number;

  // Optimal weeks for maximum retention with full expanding schedule.
  // Research: 8-12 weeks for comprehensive exam preparation.
  optimalPrepWeeks: number;

  // ── Interval schedules (research-calibrated by available time) ────────────
  intervalSchedules: IntervalSchedules;

  // ── Session design ───────────────────────────────────────────────────────
  // Optimal session length in minutes before cognitive fatigue degrades encoding.
  // Research (Pomodoro studies, cognitive load literature): 25-60 minutes.
  sessionLengthMinutes: number;

  // Maximum new cards to introduce per session before consolidation degrades.
  // Research (working memory load): ~25 new items per session is a practical ceiling.
  maxNewCardsPerSession: number;

  // Ratio of session time spent on active recall (testing) vs. passive review.
  // Research (Karpicke & Roediger 2007, testing effect): 0.70-0.90 active recall.
  activeRecallRatio: number;

  // ── Domain strategy ──────────────────────────────────────────────────────
  // Whether to interleave questions from all domains in each session.
  // Research (Rohrer & Taylor 2007, Kornell & Bjork 2008): interleaved practice
  // is superior to blocked practice for MCQ exams and transfer performance.
  interleaveDomains: boolean;

  // ── Overlearning ─────────────────────────────────────────────────────────
  // Whether to continue drilling cards that have been mastered.
  // Research (Roediger/USF 2006, Watanabe 2017): short overlearning (20min
  // post-mastery) provides hyper-stabilization against interference. Advantage
  // fades by 9 weeks — useful for exam prep, wasteful for long-term retention.
  overlearningEnabled: boolean;

  // ── Mock exams ───────────────────────────────────────────────────────────
  // Number of full mock exam simulations to schedule.
  // Research: 3-5 mocks total; last 1-2 within final week.
  recommendedMockExams: number;

  // Days before exam on which to schedule each mock (descending order).
  // These are used as candidates; actual mocks scheduled = recommendedMockExams.
  // Research: 21 → 14 → 7 → 3 days. Final mock no closer than 3 days out.
  mockExamDayCandidates: number[];

  // ── Final sprint (last 72 hours) ─────────────────────────────────────────
  // Research (learning scientists, consolidation literature): light active recall
  // only, 20-30 min bursts, no new material, prioritize sleep (7-9 hrs).
  finalSprintSessionMinutes: number; // session length in final 3 days
  finalSprintSessionsPerDay: number; // how many short sessions per day
}

export interface CertConfig {
  // ── Identity ──────────────────────────────────────────────────────────────
  // slug must match courses.slug in the database exactly.
  slug: string;
  // Official exam code used by the certifying body.
  examCode: string;
  // Full official certification title.
  officialTitle: string;
  // Issuing organization.
  certificationBody: string;
  // true = no vendor lock-in (CompTIA, ISC2, PMI); false = tied to a vendor.
  isVendorNeutral: boolean;
  // Vendor name when isVendorNeutral is false (AWS, Microsoft, Google Cloud).
  vendorName: string | null;

  // ── Exam logistics ─────────────────────────────────────────────────────────
  // Maximum possible questions in a sitting.
  maxQuestions: number;
  // Typical question count if usually fewer than max are given (Microsoft, Google).
  typicalQuestionCount: number | null;
  // Question format types used in this exam.
  questionTypes: ("mcq" | "pbq" | "drag-drop" | "matching" | "hotspot" | "case-study" | "essay")[];
  // Approximate number of PBQs in a typical sitting (CompTIA: ~5, AWS: varies).
  approximatePbqCount: number | null;
  durationMinutes: number;
  passingScore: PassingScore;
  // Current retail exam cost in USD.
  examCostUsd: number;
  retakePolicy: RetakePolicy;
  deliveryMethods: ("in-center" | "online-proctored")[];
  // Testing center partners (e.g., Pearson VUE, PSI, Prometric).
  testingVendors: string[];
  // ISO 639-1 language codes for available exam languages.
  languagesAvailable: string[];

  // ── Cert lifecycle — drives FEAT-004 recertification workflow ─────────────
  // How many years the credential is valid after passing. null = never expires.
  certValidityYears: number | null;
  // Renewal configuration. null if cert never expires.
  renewalConfig: RenewalConfig | null;
  // Current exam version code (used to detect when content needs updating).
  currentVersionCode: string;
  // ISO 8601 date the current version launched.
  currentVersionReleaseDate: string;
  // ISO 8601 date the current version will be retired. null = not yet announced.
  currentVersionRetirementDate: string | null;

  // ── Prerequisites ──────────────────────────────────────────────────────────
  // true = hard eligibility gate (CEH requires 2yr experience or training).
  // false = recommended only (AWS, Azure, CompTIA Security+).
  formalPrerequisites: boolean;
  // Months of relevant experience officially recommended before attempting.
  recommendedExperienceMonths: number;
  // Slugs of other certs that are recommended stepping stones.
  recommendedPriorCerts: string[];
  // Formal classroom/training hours required to sit the exam (PMP = 35).
  requiredTrainingHours: number | null;

  // ── Classification ─────────────────────────────────────────────────────────
  level: CertLevel;
  // Broad domain: "cybersecurity" | "cloud" | "networking" | "project-management"
  // | "data" | "devops" | "development" | "it-support"
  specialization: string;
  // Narrower sub-specialization within the domain, or null for generalist certs.
  specialtyArea: string | null;
  // Industry verticals where this cert is commonly required or valued.
  industrySectors: string[];
  // Job titles this cert commonly unlocks or is required for.
  jobRoles: string[];
  // Cert family / learning path name (for grouped display).
  certFamilyName: string | null;
  // Position within the cert family path (1 = entry, 2 = mid, etc.).
  certFamilyPosition: number | null;

  // ── Content / domains — drives FEAT-002 preparedness score weighting ───────
  // Domains with official exam weight percentages. Must sum to 100.
  domains: ExamDomain[];
  // true = computerized adaptive testing (ISC2 CAT exams).
  // CAT exams have variable question counts — SRS strategy differs.
  adaptiveTesting: boolean;

  // ── Compliance / recognition ───────────────────────────────────────────────
  // DoD 8570.01-M job role categories this cert satisfies.
  dod8570Categories: DodCategory[] | null;
  // DoD 8140 (successor to 8570) role categories.
  dod8140Categories: DodCategory[] | null;
  // Accredited under ISO/IEC 17024 Personnel Certification standard.
  iso17024Accredited: boolean;
  // Accredited by ANSI National Accreditation Board (ANAB).
  ansiAccredited: boolean;
  // Other government frameworks or mandates that recognize this cert.
  governmentRecognition: string[];

  // ── Retention plan — drives srs-engine scheduling and study plan ───────────
  // Total unique questions in the platform's practice bank for this cert.
  // Starts small and grows. The algorithm uses this to compute acquisition phase.
  questionPoolSize: number;

  // Per-cert SRS and study plan configuration. Used by computeRetentionPlan().
  retentionPlan: RetentionPlanConfig;

  // Backward-compat shortcut: default interval sequence for the SRS engine.
  // Equivalent to retentionPlan.intervalSchedules.fullPrep.
  defaultIntervals: number[];

  // Compressed interval sequence for recertification refresh cycles.
  recertIntervals: number[];

  // Total estimated study hours for a first-time candidate.
  recommendedStudyHours: number;

  // ── Market data ────────────────────────────────────────────────────────────
  // US average salary for roles that list this cert. null = not well-documented.
  averageSalaryUsd: number | null;
  // Canonical URL for the official exam page.
  officialExamPageUrl: string;
  // URL to download the official exam objectives PDF.
  officialObjectivesUrl: string;
}
