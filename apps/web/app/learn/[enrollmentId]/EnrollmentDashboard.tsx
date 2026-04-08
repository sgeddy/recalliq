"use client";

import { useState, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types (exported so page.tsx can use them for the fetch shape)
// ---------------------------------------------------------------------------

export interface DashboardDomain {
  moduleId: string;
  moduleName: string;
  modulePosition: number;
  totalCards: number;
  attemptedCards: number;
  correctReviews: number;
  totalReviews: number;
  weightPercent: number | null;
}

export interface DashboardCard {
  cardId: string;
  moduleId: string;
  moduleName: string;
  front: string;
  cardType: string;
  attempts: number;
  correct: number;
  currentIntervalIndex: number;
  nextDueAt: string | null;
}

export interface DashboardData {
  enrollment: {
    id: string;
    status: string;
    createdAt: string;
    examDate: string | null;
    examResult: string | null;
  };
  course: {
    title: string;
    slug: string;
    defaultIntervals: number[];
  };
  stats: {
    totalCards: number;
    attemptedCards: number;
    totalReviews: number;
    correctReviews: number;
    incorrectReviews: number;
    hasDueCards: boolean;
  };
  domains: DashboardDomain[];
  sessions: {
    past: { date: string; reviewed: number; correct: number }[];
    upcoming: { date: string; cardCount: number }[];
  };
  cards: DashboardCard[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}

function pctNum(num: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.round((num / denom) * 100);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const CARDS_PER_PAGE = 25;

type Tab = "overview" | "sessions" | "questions";
type CardSortKey = "domain" | "attempts" | "correct" | "next";

interface Props extends DashboardData {
  domains: DashboardDomain[];
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  value,
  label,
  highlight,
}: {
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 text-center ${
        highlight ? "border-indigo-200 bg-indigo-50" : "border-gray-200 bg-white"
      }`}
    >
      <p className={`text-2xl font-bold ${highlight ? "text-indigo-700" : "text-gray-900"}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </div>
  );
}

// ── Interval level dots ──────────────────────────────────────────────────────
function LevelDots({ index, max }: { index: number; max: number }) {
  const dots = Math.max(max, 1);
  return (
    <span className="flex items-center gap-0.5" aria-label={`Level ${index} of ${max}`}>
      {Array.from({ length: dots }).map((_, i) => (
        <span
          key={i}
          className={`inline-block h-2 w-2 rounded-full ${
            i < index ? "bg-indigo-500" : "bg-gray-200"
          }`}
        />
      ))}
    </span>
  );
}

// ── Domain coverage table ────────────────────────────────────────────────────
function DomainCoverageTable({ domains }: { domains: DashboardDomain[] }) {
  if (domains.length === 0) {
    return <p className="text-sm text-gray-400">No domain data yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3">Domain</th>
            <th className="px-4 py-3 text-right">Weight</th>
            <th className="px-4 py-3 text-right">Cards</th>
            <th className="w-40 px-4 py-3">Coverage</th>
            <th className="px-4 py-3 text-right">Correct rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {domains.map((d) => {
            const coveragePct = pctNum(d.attemptedCards, d.totalCards);
            const correctPct = pctNum(d.correctReviews, d.totalReviews);
            return (
              <tr key={d.moduleId}>
                <td className="px-4 py-3 font-medium text-gray-800">
                  <span className="mr-2 text-xs text-gray-400">{d.modulePosition}.</span>
                  {d.moduleName}
                </td>
                <td className="px-4 py-3 text-right">
                  {d.weightPercent !== null ? (
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      {d.weightPercent}%
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">
                  {d.attemptedCards}/{d.totalCards}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${coveragePct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs text-gray-500">{coveragePct}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  {d.totalReviews === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <span
                      className={
                        correctPct >= 80
                          ? "font-medium text-green-700"
                          : correctPct >= 60
                            ? "font-medium text-amber-700"
                            : "font-medium text-red-700"
                      }
                    >
                      {correctPct}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Sessions tab ─────────────────────────────────────────────────────────────
function SessionsTab({
  past,
  upcoming,
}: {
  past: { date: string; reviewed: number; correct: number }[];
  upcoming: { date: string; cardCount: number }[];
}) {
  return (
    <div className="space-y-8">
      {/* Upcoming */}
      <div>
        <h3 className="mb-3 font-semibold text-gray-900">Upcoming sessions</h3>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm text-gray-400">
            No upcoming sessions scheduled yet. Complete a session to unlock the next one.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Days away</th>
                  <th className="px-4 py-3 text-right">Cards due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {upcoming.map((s) => {
                  const days = daysUntil(s.date);
                  return (
                    <tr key={s.date}>
                      <td className="px-4 py-3 font-medium text-gray-800">{fmtDate(s.date)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {days <= 0 ? (
                          <span className="font-medium text-indigo-600">Today</span>
                        ) : (
                          `${days} day${days === 1 ? "" : "s"}`
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.cardCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Past */}
      <div>
        <h3 className="mb-3 font-semibold text-gray-900">Past sessions</h3>
        {past.length === 0 ? (
          <p className="rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm text-gray-400">
            No sessions completed yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Reviewed</th>
                  <th className="px-4 py-3 text-right">Correct</th>
                  <th className="px-4 py-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {past.map((s) => {
                  const scorePct = pctNum(s.correct, s.reviewed);
                  return (
                    <tr key={s.date}>
                      <td className="px-4 py-3 font-medium text-gray-800">{fmtDate(s.date)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.reviewed}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{s.correct}</td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-medium ${
                            scorePct >= 80
                              ? "text-green-700"
                              : scorePct >= 60
                                ? "text-amber-700"
                                : "text-red-700"
                          }`}
                        >
                          {scorePct}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card browser tab ─────────────────────────────────────────────────────────
function CardBrowser({
  cards,
  maxIntervalIndex,
}: {
  cards: DashboardCard[];
  maxIntervalIndex: number;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CardSortKey>("domain");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cards.filter(
      (c) =>
        q === "" || c.front.toLowerCase().includes(q) || c.moduleName.toLowerCase().includes(q),
    );
  }, [cards, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sort === "domain") {
        const domainCmp = a.moduleName.localeCompare(b.moduleName);
        return domainCmp !== 0 ? domainCmp : a.front.localeCompare(b.front);
      }
      if (sort === "attempts") return b.attempts - a.attempts;
      if (sort === "correct") {
        const aPct = a.attempts === 0 ? -1 : a.correct / a.attempts;
        const bPct = b.attempts === 0 ? -1 : b.correct / b.attempts;
        return bPct - aPct;
      }
      if (sort === "next") {
        if (!a.nextDueAt && !b.nextDueAt) return 0;
        if (!a.nextDueAt) return 1;
        if (!b.nextDueAt) return -1;
        return a.nextDueAt.localeCompare(b.nextDueAt);
      }
      return 0;
    });
  }, [filtered, sort]);

  const totalPages = Math.ceil(sorted.length / CARDS_PER_PAGE);
  const pageItems = sorted.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

  function handleSearch(val: string) {
    setSearch(val);
    setPage(0);
  }

  function handleSort(key: CardSortKey) {
    setSort(key);
    setPage(0);
  }

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search questions…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span className="hidden sm:inline">Sort:</span>
          {(
            [
              ["domain", "Domain"],
              ["attempts", "Most reviewed"],
              ["correct", "Correct %"],
              ["next", "Due date"],
            ] as [CardSortKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleSort(key)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                sort === key ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-2 text-xs text-gray-400">
        {filtered.length} question{filtered.length === 1 ? "" : "s"}
        {search ? ` matching "${search}"` : ""}
      </p>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Question</th>
              <th className="hidden px-4 py-3 md:table-cell">Domain</th>
              <th className="px-4 py-3 text-right">Reviews</th>
              <th className="px-4 py-3 text-right">Correct</th>
              <th className="hidden px-4 py-3 sm:table-cell">Level</th>
              <th className="hidden px-4 py-3 text-right lg:table-cell">Next due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No questions found.
                </td>
              </tr>
            ) : (
              pageItems.map((c) => (
                <tr key={c.cardId} className="hover:bg-gray-50">
                  <td className="max-w-xs px-4 py-3">
                    <p className="truncate text-gray-800" title={c.front}>
                      {c.front}
                    </p>
                  </td>
                  <td className="hidden px-4 py-3 text-gray-500 md:table-cell">
                    <span className="truncate">{c.moduleName}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{c.attempts}</td>
                  <td className="px-4 py-3 text-right">
                    {c.attempts === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span
                        className={`font-medium ${
                          pctNum(c.correct, c.attempts) >= 80
                            ? "text-green-700"
                            : pctNum(c.correct, c.attempts) >= 60
                              ? "text-amber-700"
                              : "text-red-700"
                        }`}
                      >
                        {pct(c.correct, c.attempts)}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <LevelDots index={c.currentIntervalIndex} max={maxIntervalIndex} />
                  </td>
                  <td className="hidden px-4 py-3 text-right text-gray-500 lg:table-cell">
                    {c.nextDueAt ? fmtDateShort(c.nextDueAt) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function EnrollmentDashboard(props: Props) {
  const { enrollment, course, stats, domains, sessions, cards } = props;
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const completePct = pctNum(stats.attemptedCards, stats.totalCards);
  const correctPct =
    stats.totalReviews > 0 ? pctNum(stats.correctReviews, stats.totalReviews) : null;
  const nextUpcoming = sessions.upcoming[0];
  const maxIntervalIndex = Math.max(course.defaultIntervals.length, 1);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    {
      key: "sessions",
      label: `Sessions${sessions.past.length > 0 ? ` (${sessions.past.length})` : ""}`,
    },
    { key: "questions", label: `Questions (${stats.totalCards})` },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      {/* ── Breadcrumb + header ─────────────────────────────────────────── */}
      <div className="mb-2">
        <a href="/courses" className="text-sm text-indigo-600 hover:underline">
          ← My courses
        </a>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{course.title}</h1>
            <p className="mt-1 text-sm text-gray-500">
              Enrolled {fmtDate(enrollment.createdAt)}
              {enrollment.examDate && (
                <>
                  {" · "}
                  Exam: <strong className="text-gray-700">{fmtDate(enrollment.examDate)}</strong>
                </>
              )}
            </p>
          </div>
          <span
            className={`mt-1 rounded-full px-3 py-1 text-xs font-semibold capitalize ${
              enrollment.status === "active"
                ? "bg-green-100 text-green-800"
                : enrollment.status === "completed"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-gray-100 text-gray-600"
            }`}
          >
            {enrollment.status}
          </span>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard value={String(stats.totalCards)} label="Questions" />
        <StatCard value={`${completePct}%`} label="Attempted" highlight={completePct > 0} />
        <StatCard
          value={correctPct !== null ? `${correctPct}%` : "—"}
          label="Correct rate"
          highlight={correctPct !== null && correctPct >= 75}
        />
        <StatCard
          value={
            stats.hasDueCards ? "Due now!" : nextUpcoming ? fmtDateShort(nextUpcoming.date) : "—"
          }
          label="Next session"
          highlight={stats.hasDueCards}
        />
      </div>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      {stats.hasDueCards && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-5 py-4">
          <p className="font-medium text-indigo-900">You have cards ready to review.</p>
          <a
            href={`/session/${enrollment.id}`}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Start session
          </a>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-indigo-600 text-indigo-700"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-8">
          {/* Domain coverage */}
          <section>
            <h2 className="mb-3 font-semibold text-gray-900">Domain coverage</h2>
            {stats.attemptedCards === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white px-5 py-8 text-center">
                <p className="mb-1 font-medium text-gray-700">You haven&rsquo;t started yet.</p>
                <p className="mb-4 text-sm text-gray-500">
                  Complete your first session to start seeing progress.
                </p>
                <a
                  href={`/session/${enrollment.id}`}
                  className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Start your first session
                </a>
              </div>
            ) : (
              <DomainCoverageTable domains={domains} />
            )}
          </section>

          {/* Overall progress bar */}
          {stats.attemptedCards > 0 && (
            <section>
              <h2 className="mb-3 font-semibold text-gray-900">Overall progress</h2>
              <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
                <div className="mb-2 flex justify-between text-sm text-gray-600">
                  <span>
                    {stats.attemptedCards} of {stats.totalCards} questions attempted
                  </span>
                  <span className="font-medium">{completePct}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-3 rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${completePct}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-3 divide-x divide-gray-100 text-center text-sm">
                  <div>
                    <p className="font-semibold text-gray-900">{stats.totalReviews}</p>
                    <p className="text-xs text-gray-500">Total reviews</p>
                  </div>
                  <div>
                    <p className="font-semibold text-green-700">{stats.correctReviews}</p>
                    <p className="text-xs text-gray-500">Correct</p>
                  </div>
                  <div>
                    <p className="font-semibold text-red-600">{stats.incorrectReviews}</p>
                    <p className="text-xs text-gray-500">Incorrect</p>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === "sessions" && (
        <SessionsTab past={sessions.past} upcoming={sessions.upcoming} />
      )}

      {activeTab === "questions" && (
        <CardBrowser cards={cards} maxIntervalIndex={maxIntervalIndex} />
      )}
    </div>
  );
}
