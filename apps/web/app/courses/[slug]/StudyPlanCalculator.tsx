"use client";

import { useMemo, useState, useTransition } from "react";

import { useAuth } from "@clerk/nextjs";
import { computeRetentionPlan } from "@recalliq/srs-engine";
import type {
  Chronotype,
  MaintenancePlan,
  MockExam,
  PriorKnowledge,
  RetentionPlan,
  StudyPhase,
} from "@recalliq/srs-engine";
import type { CertConfig } from "@recalliq/types";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionConfig {
  dailyStudyMinutes: number;
  weeksUntilExam: number;
  chronotype: Chronotype;
  priorKnowledge: PriorKnowledge;
}

interface Props {
  certConfig: CertConfig;
  // When provided, a "Save plan" button appears that persists settings to the enrollment.
  enrollmentId?: string;
  initialValues?: Partial<SessionConfig>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WEEKS_OPTIONS = [2, 4, 8, 12, 16] as const;
const MINUTES_OPTIONS = [30, 45, 60, 90] as const;

const CHRONOTYPE_OPTIONS: { value: Chronotype; label: string }[] = [
  { value: "morning", label: "Morning person" },
  { value: "neutral", label: "Flexible" },
  { value: "evening", label: "Night owl" },
];

const KNOWLEDGE_OPTIONS: { value: PriorKnowledge; label: string }[] = [
  { value: "none", label: "New to this" },
  { value: "basic", label: "Some exposure" },
  { value: "experienced", label: "Experienced" },
];

// Phase color tokens — muted palette for a professional, data-forward look.
// Ordered: acquisition → consolidation → mock/targeting → sprint.
const PHASE_COLORS: Record<string, { bg: string; bar: string; dot: string; border: string }> = {
  Acquisition: {
    bg: "bg-indigo-50",
    bar: "bg-indigo-400",
    dot: "bg-indigo-500",
    border: "border-indigo-200",
  },
  Consolidation: {
    bg: "bg-violet-50",
    bar: "bg-violet-400",
    dot: "bg-violet-500",
    border: "border-violet-200",
  },
  "Mock Exam & Weak-Spot Targeting": {
    bg: "bg-amber-50",
    bar: "bg-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-200",
  },
  "Final Sprint": {
    bg: "bg-rose-50",
    bar: "bg-rose-400",
    dot: "bg-rose-500",
    border: "border-rose-200",
  },
};

// Fallback when a phase name doesn't match known keys.
const FALLBACK_COLOR = {
  bg: "bg-gray-50",
  bar: "bg-gray-400",
  dot: "bg-gray-500",
  border: "border-gray-200",
};

function phaseColor(phaseName: string) {
  // Partial match — phase names can have suffixes like "(compressed)".
  for (const key of Object.keys(PHASE_COLORS)) {
    if (phaseName.startsWith(key)) return PHASE_COLORS[key]!;
  }
  return FALLBACK_COLOR;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PillGroupProps<T extends string | number> {
  label: string;
  options: readonly { value: T; label: string }[] | readonly T[];
  value: T;
  onChange: (v: T) => void;
  formatLabel?: (v: T) => string;
  id: string;
}

function PillGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  formatLabel,
  id,
}: PillGroupProps<T>) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </legend>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
        {(options as readonly (T | { value: T; label: string })[]).map((opt) => {
          const optValue =
            typeof opt === "object" && opt !== null && "value" in opt
              ? (opt as { value: T; label: string }).value
              : (opt as T);
          const optLabel =
            typeof opt === "object" && opt !== null && "label" in opt
              ? (opt as { value: T; label: string }).label
              : formatLabel
                ? formatLabel(opt as T)
                : String(opt);
          const isSelected = optValue === value;
          return (
            <button
              key={String(optValue)}
              type="button"
              onClick={() => onChange(optValue)}
              aria-pressed={isSelected}
              className={[
                "min-h-[36px] rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500",
                isSelected
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700",
              ].join(" ")}
            >
              {optLabel}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Phase timeline bar
// ---------------------------------------------------------------------------

function PhaseTimeline({ phases }: { phases: StudyPhase[] }) {
  const totalDays = phases.reduce((sum, p) => sum + p.durationDays, 0);
  if (totalDays === 0) return null;

  return (
    <div className="mb-8">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Study Timeline
      </h3>

      {/* Bar */}
      <div
        className="flex h-8 w-full overflow-hidden rounded-lg"
        role="img"
        aria-label="Study phase timeline bar"
      >
        {phases.map((phase) => {
          const widthPct = (phase.durationDays / totalDays) * 100;
          const colors = phaseColor(phase.name);
          return (
            <div
              key={phase.name}
              className={`${colors.bar} flex items-center justify-center overflow-hidden`}
              style={{ width: `${widthPct}%` }}
              title={`${phase.name}: Weeks ${phase.startWeek}–${phase.endWeek}`}
            />
          );
        })}
      </div>

      {/* Labels below bar */}
      <div className="mt-2 flex w-full">
        {phases.map((phase) => {
          const widthPct = (phase.durationDays / totalDays) * 100;
          const colors = phaseColor(phase.name);
          return (
            <div key={phase.name} className="overflow-hidden" style={{ width: `${widthPct}%` }}>
              <div className="flex items-center gap-1 pr-2">
                <span
                  className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${colors.dot}`}
                  aria-hidden="true"
                />
                <span className="truncate text-xs text-gray-600">{phase.name}</span>
              </div>
              <span className="pl-3 text-xs text-gray-400">
                Wk {phase.startWeek}–{phase.endWeek}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Collapsible({
  heading,
  children,
  defaultOpen = false,
}: {
  heading: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-3 flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {heading}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 10.5a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 1 1 1.06-1.06L8 8.69l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22z" />
        </svg>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maintenance plan display
// ---------------------------------------------------------------------------

function MaintenancePlanDisplay({
  plan,
  examDate,
}: {
  plan: MaintenancePlan;
  examDate: string | null;
}) {
  return (
    <section className="mt-10 rounded-xl border border-teal-200 bg-teal-50 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600">
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 text-white"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div>
          <h3 className="font-semibold text-teal-900">Post-Exam Maintenance Program</h3>
          <p className="mt-1 text-sm leading-relaxed text-teal-800">{plan.rationale}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {plan.intervals.map((interval) => (
          <div key={interval.label} className="rounded-lg border border-teal-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-teal-700">{interval.label}</span>
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-600">
                {interval.sessionMinutes} min
              </span>
            </div>
            <p className="mb-2 text-xl font-bold text-gray-900">
              {interval.questionCount}
              <span className="ml-1 text-sm font-normal text-gray-500">questions</span>
            </p>
            {examDate && (
              <p className="mb-2 text-xs font-medium text-teal-600">
                {formatMaintenanceDate(examDate, interval.daysAfterExam)}
              </p>
            )}
            <p className="text-xs leading-relaxed text-gray-500">{interval.purpose}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-teal-600">
        {examDate
          ? "RecallIQ will remind you at each interval automatically after you record your exam result."
          : "Set your exam date above to see your exact maintenance schedule. RecallIQ will remind you at each interval automatically."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Plan display
// ---------------------------------------------------------------------------

function PlanDisplay({ plan }: { plan: RetentionPlan }) {
  return (
    <div>
      {/* ── Header stats ──────────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-4xl font-extrabold tracking-tight text-gray-900">
            {plan.totalStudyHours}
            <span className="ml-1.5 text-2xl font-semibold text-gray-400">hrs total</span>
          </p>
          <p className="mt-1">
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-0.5 text-xs font-medium text-indigo-700">
              {plan.intervalScheduleLabel}
            </span>
            {plan.partialPoolCoverage && (
              <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700">
                {plan.coveragePercent}% of exam questions covered
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{plan.questionsCovered}</p>
            <p className="text-xs text-gray-500">questions covered</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{plan.totalSessions}</p>
            <p className="text-xs text-gray-500">total sessions</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{plan.peakDailyMinutes}</p>
            <p className="text-xs text-gray-500">peak min/day</p>
          </div>
        </div>
      </div>

      {/* ── Feasibility warning ───────────────────────────────────────────── */}
      {plan.feasibilityNote && (
        <div
          className="mb-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
          role="alert"
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0V5zm-.75 6.5a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75z" />
          </svg>
          <p className="text-sm text-amber-800">{plan.feasibilityNote}</p>
        </div>
      )}

      {/* ── Long-term retention note ─────────────────────────────────────── */}
      {plan.longTermRetentionNote && (
        <div
          className="mb-6 flex gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3"
          role="note"
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-teal-600"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 4a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0V5zm-.75 6.5a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75z" />
          </svg>
          <p className="text-sm text-teal-800">{plan.longTermRetentionNote}</p>
        </div>
      )}

      {/* ── Phase timeline ────────────────────────────────────────────────── */}
      <PhaseTimeline phases={plan.phases} />

      {/* ── Daily schedule — directly below timeline ─────────────────────── */}
      <div className="mb-6">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Daily Schedule
        </h3>
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-indigo-100 bg-white px-4 py-3">
              <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-500">
                New cards
              </p>
              <p className="font-semibold text-gray-900">
                {plan.studyScheduleRecommendation.newCardsTime}
              </p>
            </div>
            <div className="rounded-md border border-indigo-100 bg-white px-4 py-3">
              <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-500">
                Reviews
              </p>
              <p className="font-semibold text-gray-900">
                {plan.studyScheduleRecommendation.reviewTime}
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed text-indigo-800">
            {plan.studyScheduleRecommendation.rationale}
          </p>
        </div>
      </div>

      {/* ── Mock exam schedule ────────────────────────────────────────────── */}
      {plan.mockExams.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Mock Exam Schedule
          </h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm" aria-label="Mock exam schedule">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th
                    scope="col"
                    className="py-2.5 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    Mock
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    Week
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    Days out
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
                  >
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.mockExams.map((mock, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-3 pl-4 pr-3 font-medium text-gray-900">Mock {i + 1}</td>
                    <td className="px-3 py-3 text-gray-600">Week {mock.weekNumber}</td>
                    <td className="px-3 py-3 text-gray-600">{mock.daysBeforeExam}d</td>
                    <td className="px-3 py-3 pr-4 text-gray-500">{mock.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Phase breakdown — collapsed by default ────────────────────────── */}
      <Collapsible heading="Phase Breakdown">
        <div className="grid gap-3 sm:grid-cols-2">
          {plan.phases.map((phase) => {
            const colors = phaseColor(phase.name);
            return (
              <div
                key={phase.name}
                className={`rounded-lg border ${colors.border} ${colors.bg} p-4`}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${colors.dot}`}
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-gray-900">{phase.name}</span>
                  <span className="ml-auto text-xs text-gray-500">
                    Wk {phase.startWeek}–{phase.endWeek}
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-white bg-white px-2 py-1.5 text-center">
                    <p className="text-base font-bold text-gray-900">{phase.dailyNewCards}</p>
                    <p className="text-xs text-gray-500">new/day</p>
                  </div>
                  <div className="rounded-md border border-white bg-white px-2 py-1.5 text-center">
                    <p className="text-base font-bold text-gray-900">
                      {phase.estimatedDailyReviews}
                    </p>
                    <p className="text-xs text-gray-500">reviews/day</p>
                  </div>
                  <div className="rounded-md border border-white bg-white px-2 py-1.5 text-center">
                    <p className="text-base font-bold text-gray-900">
                      {phase.estimatedDailyMinutes}
                    </p>
                    <p className="text-xs text-gray-500">min/day</p>
                  </div>
                </div>
                <p className="mb-2 text-sm text-gray-700">
                  <span className="font-medium">{phase.sessionsPerDay}</span>
                  {" × "}
                  <span className="font-medium">{phase.sessionLengthMinutes} min</span>
                  {phase.sessionsPerDay !== 1 ? " sessions" : " session"}
                  <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">
                    {phase.domainStrategy === "interleaved"
                      ? "Interleaved"
                      : phase.domainStrategy === "weak-first"
                        ? "Weak-first"
                        : "Domain by domain"}
                  </span>
                </p>
                {phase.notes && (
                  <p className="text-xs leading-relaxed text-gray-500">{phase.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      </Collapsible>

      {/* ── Final 72 hours — collapsed by default ────────────────────────── */}
      <Collapsible heading="Final 72 Hours">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-green-600">
              Focus on
            </p>
            <p className="text-sm leading-relaxed text-gray-800">{plan.finalSprint.focus}</p>
            <p className="mt-3 text-xs text-gray-500">
              {plan.finalSprint.sessionsPerDay} × {plan.finalSprint.sessionLengthMinutes} min
              sessions/day
            </p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600">
              Avoid
            </p>
            <p className="text-sm leading-relaxed text-gray-800">{plan.finalSprint.avoid}</p>
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Add days to a date and return a locale-formatted string (e.g. "March 15, 2027").
function formatMaintenanceDate(examDateStr: string, daysAfterExam: number): string {
  const date = new Date(examDateStr);
  date.setDate(date.getDate() + daysAfterExam);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Compute weeks between today and a given date string. Returns 0 if in the past.
function weeksUntil(dateStr: string): number {
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.round(diff / MS_PER_WEEK));
}

export function StudyPlanCalculator({ certConfig, enrollmentId, initialValues }: Props) {
  const { getToken } = useAuth();
  const [weeksUntilExam, setWeeksUntilExam] = useState<number>(initialValues?.weeksUntilExam ?? 8);
  const [dailyStudyMinutes, setDailyStudyMinutes] = useState<number>(
    initialValues?.dailyStudyMinutes ?? 60,
  );
  const [chronotype, setChronotype] = useState<Chronotype>(initialValues?.chronotype ?? "neutral");
  const [priorKnowledge, setPriorKnowledge] = useState<PriorKnowledge>(
    initialValues?.priorKnowledge ?? "none",
  );
  // Exam date is optional — when set it overrides the weeks picker.
  const [examDate, setExamDate] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, startSaveTransition] = useTransition();

  // When an exam date is set, derive weeks from it; otherwise use the pill selection.
  const effectiveWeeks = examDate ? Math.max(1, weeksUntil(examDate)) : weeksUntilExam;

  const plan = useMemo<RetentionPlan>(
    () =>
      computeRetentionPlan(certConfig, {
        weeksUntilExam: effectiveWeeks,
        dailyStudyMinutes,
        chronotype,
        priorKnowledge,
      }),
    [certConfig, effectiveWeeks, dailyStudyMinutes, chronotype, priorKnowledge],
  );

  // A string key that changes on every input change — drives the CSS fade-in.
  const planKey = `${effectiveWeeks}-${dailyStudyMinutes}-${chronotype}-${priorKnowledge}`;

  async function handleSavePlan() {
    if (!enrollmentId) return;
    setSaveStatus("saving");
    startSaveTransition(async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/enrollments/${enrollmentId}/session-config`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token ?? ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dailyStudyMinutes,
            weeksUntilExam: effectiveWeeks,
            chronotype,
            priorKnowledge,
          }),
        });
        setSaveStatus(res.ok ? "saved" : "error");
        if (res.ok) setTimeout(() => setSaveStatus("idle"), 3000);
      } catch {
        setSaveStatus("error");
      }
    });
  }

  // Minimum date the user can select (today).
  const todayStr = new Date().toISOString().split("T")[0]!;

  return (
    <section aria-labelledby="study-plan-heading">
      <h2 id="study-plan-heading" className="mb-6 text-xl font-semibold text-gray-900">
        Your Study Plan
      </h2>

      {/* ── Input form ──────────────────────────────────────────────────────── */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {/* Show weeks picker only when no exam date is set */}
          {!examDate ? (
            <PillGroup
              id="weeks-group"
              label="Weeks until exam"
              options={WEEKS_OPTIONS}
              value={weeksUntilExam}
              onChange={setWeeksUntilExam}
              formatLabel={(v) => `${v} wk`}
            />
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Weeks until exam
              </p>
              <p className="rounded-full border border-indigo-600 bg-indigo-600 px-4 py-1.5 text-center text-sm font-medium text-white">
                {effectiveWeeks} wk
              </p>
            </div>
          )}
          <PillGroup
            id="minutes-group"
            label="Daily study time"
            options={MINUTES_OPTIONS}
            value={dailyStudyMinutes}
            onChange={setDailyStudyMinutes}
            formatLabel={(v) => `${v} min`}
          />
          <PillGroup
            id="chronotype-group"
            label="Chronotype"
            options={CHRONOTYPE_OPTIONS}
            value={chronotype}
            onChange={setChronotype}
          />
          <PillGroup
            id="knowledge-group"
            label="Background"
            options={KNOWLEDGE_OPTIONS}
            value={priorKnowledge}
            onChange={setPriorKnowledge}
          />
        </div>

        {/* Exam date — optional; replaces weeks picker when set */}
        <div className="mt-5 border-t border-gray-100 pt-4">
          <label
            htmlFor="exam-date"
            className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500"
          >
            Exam date{" "}
            <span className="font-normal normal-case text-gray-400">
              (optional — set for exact dates)
            </span>
          </label>
          <div className="flex items-center gap-3">
            <input
              id="exam-date"
              type="date"
              min={todayStr}
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {examDate && (
              <button
                type="button"
                onClick={() => setExamDate("")}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Save button — only shown when used in enrollment context */}
        {enrollmentId && (
          <div className="mt-5 flex items-center gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => void handleSavePlan()}
              disabled={saveStatus === "saving"}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saveStatus === "saving" ? "Saving…" : "Save plan"}
            </button>
            {saveStatus === "saved" && (
              <span className="text-sm text-green-700">Plan saved — session size updated.</span>
            )}
            {saveStatus === "error" && (
              <span className="text-sm text-red-600">Failed to save. Please try again.</span>
            )}
          </div>
        )}
      </div>

      {/* ── Plan output ─────────────────────────────────────────────────────── */}
      {/*
        The key prop causes React to remount the wrapper on input changes,
        which re-triggers the CSS animation defined in globals.css.
        We animate only opacity — no layout-triggering properties.
      */}
      <div key={planKey} className="animate-plan-fade" aria-live="polite" aria-atomic="true">
        <PlanDisplay plan={plan} />
        <MaintenancePlanDisplay plan={plan.maintenancePlan} examDate={examDate || null} />
      </div>
    </section>
  );
}
