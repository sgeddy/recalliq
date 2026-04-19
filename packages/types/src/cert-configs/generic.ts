import type { CertConfig, ExamDomain, RetentionPlanConfig } from "../cert-config.js";

// Default retention plan for user-generated courses that aren't in the
// registered cert registry. Mirrors research-calibrated defaults from
// comptia-security-plus but without the cert-specific retention plan tuning.
const DEFAULT_RETENTION_PLAN: RetentionPlanConfig = {
  targetRetentionRate: 0.9,
  targetRepetitionsPerCard: 5,
  minPrepWeeks: 4,
  optimalPrepWeeks: 12,
  intervalSchedules: {
    fullPrep: [0, 1, 4, 10, 25, 60, 150, 365],
    standard: [0, 1, 3, 7, 14, 30, 60],
    compressed: [0, 1, 2, 5, 10, 21],
    emergency: [0, 1, 2, 4, 7, 14],
  },
  sessionLengthMinutes: 45,
  maxNewCardsPerSession: 25,
  activeRecallRatio: 0.8,
  interleaveDomains: true,
  overlearningEnabled: true,
  recommendedMockExams: 3,
  mockExamDayCandidates: [21, 14, 7, 3],
  finalSprintSessionMinutes: 20,
  finalSprintSessionsPerDay: 2,
};

export interface GenericCertConfigInputs {
  slug: string;
  title: string;
  // Module titles, ordered by module position (position 1 first).
  moduleNames: string[];
  // Total number of cards in the course — drives coverage and pacing.
  questionPoolSize: number;
  // Exam duration in minutes. Defaults to 90 when unknown.
  durationMinutes?: number;
}

// Build a CertConfig-compatible shape for a user-generated course that has no
// entry in the registered cert registry. Domain weights are distributed
// equally across the course's modules (remainder goes to the first N
// domains so weights still sum to 100).
//
// Only the fields consumed by the study plan pipeline carry meaningful
// values — identity/classification/compliance fields are placeholder data
// because they don't apply to user-uploaded courses. The UI should gate
// cert-specific sections (exam overview, compliance badges) on the
// registered certConfigs registry, not on this fallback.
export function buildGenericCertConfig(inputs: GenericCertConfigInputs): CertConfig {
  const { slug, title, moduleNames, questionPoolSize, durationMinutes = 90 } = inputs;
  const domainCount = Math.max(1, moduleNames.length);
  const baseWeight = Math.floor(100 / domainCount);
  const remainder = 100 - baseWeight * domainCount;
  const domains: ExamDomain[] = (moduleNames.length > 0 ? moduleNames : ["General"]).map(
    (name, i) => ({
      name,
      weightPercent: baseWeight + (i < remainder ? 1 : 0),
    }),
  );

  return {
    slug,
    examCode: "CUSTOM",
    officialTitle: title,
    certificationBody: "Custom",
    isVendorNeutral: true,
    vendorName: null,

    maxQuestions: questionPoolSize,
    typicalQuestionCount: null,
    questionTypes: ["mcq"],
    approximatePbqCount: null,
    durationMinutes,
    passingScore: { scaled: 750, scaleMax: 900, scaleMin: 100, percentage: null },
    examCostUsd: 0,
    retakePolicy: {
      firstAttemptWaitDays: 0,
      subsequentWaitDays: 0,
      maxAttemptsPerYear: null,
      canRetakeAfterPass: true,
    },
    deliveryMethods: ["online-proctored"],
    testingVendors: [],
    languagesAvailable: ["en"],

    certValidityYears: null,
    renewalConfig: null,
    currentVersionCode: "v1",
    currentVersionReleaseDate: new Date().toISOString().split("T")[0] ?? "2024-01-01",
    currentVersionRetirementDate: null,

    formalPrerequisites: false,
    recommendedExperienceMonths: 0,
    recommendedPriorCerts: [],
    requiredTrainingHours: null,

    level: "foundational",
    specialization: "custom",
    specialtyArea: null,
    industrySectors: [],
    jobRoles: [],
    certFamilyName: null,
    certFamilyPosition: null,

    domains,
    adaptiveTesting: false,

    dod8570Categories: null,
    dod8140Categories: null,
    iso17024Accredited: false,
    ansiAccredited: false,
    governmentRecognition: [],

    questionPoolSize,
    retentionPlan: DEFAULT_RETENTION_PLAN,
    defaultIntervals: DEFAULT_RETENTION_PLAN.intervalSchedules.fullPrep,
    recertIntervals: [0, 1, 3, 7, 14, 30, 60],
    recommendedStudyHours: 60,

    averageSalaryUsd: null,
    officialExamPageUrl: "",
    officialObjectivesUrl: "",
  };
}
