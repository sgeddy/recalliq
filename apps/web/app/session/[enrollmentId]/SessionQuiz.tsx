"use client";

import { useState, useTransition } from "react";
import { useAuth } from "@clerk/nextjs";

import type { SessionCard } from "./page";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";
const LETTER_LABELS = ["A", "B", "C", "D", "E", "F"] as const;

// Assume ~90 seconds per MCQ question for estimated completion time.
const SECONDS_PER_CARD = 90;

interface Props {
  enrollmentId: string;
  courseTitle: string;
  totalCards: number;
  completedCards: number;
  cards: SessionCard[];
}

type CardState =
  | { phase: "question" }
  | { phase: "revealed" }
  | { phase: "result"; passed: boolean; nextScheduledAt: string | null };

async function submitReview(
  reviewEventId: string,
  passed: boolean,
  authToken: string,
): Promise<{ passed: boolean; nextScheduledAt: string | null }> {
  const res = await fetch(`${API_URL}/reviews/${reviewEventId}/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ passed }),
  });

  if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
  const json = (await res.json()) as {
    data: { passed: boolean; nextScheduledAt: string | null };
  };
  return json.data;
}

export function SessionQuiz({
  enrollmentId,
  courseTitle,
  totalCards,
  completedCards,
  cards,
}: Props) {
  const { getToken } = useAuth();
  const [hasStarted, setHasStarted] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardState, setCardState] = useState<CardState>({ phase: "question" });
  const [results, setResults] = useState<{ passed: boolean }[]>([]);
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const remainingCards = cards.length;
  const isResuming = completedCards > 0;

  const currentCard = cards[cardIndex];
  const isLastCard = cardIndex === cards.length - 1;
  const isDone = cardIndex >= cards.length;

  async function getAuthToken(): Promise<string> {
    const token = await getToken();
    if (!token) throw new Error("Not authenticated");
    return token;
  }

  // ── Pre-quiz intro screen ────────────────────────────────────────────────
  if (!hasStarted) {
    const estimatedMinutes = Math.ceil((remainingCards * SECONDS_PER_CARD) / 60);

    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600">
            Session
          </p>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">{courseTitle}</h1>

          {isResuming ? (
            <p className="mb-6 text-gray-500">
              You&rsquo;ve completed{" "}
              <strong className="text-gray-700">
                {completedCards} of {totalCards}
              </strong>{" "}
              questions. Pick up where you left off.
            </p>
          ) : (
            <p className="mb-6 text-gray-500">
              Your first session is ready. Work through all{" "}
              <strong className="text-gray-700">{totalCards} questions</strong> to build your
              foundation.
            </p>
          )}

          <div className="mb-8 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{remainingCards}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {isResuming ? "questions remaining" : "questions"}
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">~{estimatedMinutes} min</p>
              <p className="mt-0.5 text-xs text-gray-500">estimated time</p>
            </div>
          </div>

          <p className="mb-6 text-sm text-gray-500">
            You can exit at any time and your progress will be saved. Resume from this page.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => setHasStarted(true)}
              className="flex-1 rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700"
            >
              {isResuming ? "Resume session" : "Start session"}
            </button>
            <a
              href={`/learn/${enrollmentId}`}
              className="rounded-lg border border-gray-200 px-5 py-3 font-medium text-gray-600 hover:bg-gray-50"
            >
              Back
            </a>
          </div>
        </div>
      </main>
    );
  }

  // ── Session complete ─────────────────────────────────────────────────────
  if (isDone) {
    const passedCount = results.filter((r) => r.passed).length;
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-4 text-5xl" aria-hidden="true">
            {passedCount === cards.length ? "🎉" : "✓"}
          </div>
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Session complete!</h1>
          <p className="mb-2 text-gray-500">
            <strong>{courseTitle}</strong>
          </p>
          <p className="mb-6 text-gray-500">
            {passedCount} / {cards.length} correct
          </p>
          <a
            href={`/learn/${enrollmentId}`}
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Back to my dashboard
          </a>
        </div>
      </main>
    );
  }

  const card = currentCard!;

  function handleReveal() {
    setCardState({ phase: "revealed" });
  }

  function handleMcqAnswer(selectedIndex: number) {
    if (cardState.phase !== "question" || isPending) return;
    const passed = selectedIndex === card.correctOptionIndex;

    startTransition(async () => {
      setSubmitError(null);
      try {
        const token = await getAuthToken();
        const result = await submitReview(card.reviewEventId, passed, token);
        setCardState({
          phase: "result",
          passed: result.passed,
          nextScheduledAt: result.nextScheduledAt,
        });
        setResults((prev) => [...prev, { passed: result.passed }]);
      } catch {
        setSubmitError("Failed to save your answer. Please try again.");
      }
    });
  }

  function handleSelfAssess(knew: boolean) {
    if (cardState.phase !== "revealed" || isPending) return;

    startTransition(async () => {
      setSubmitError(null);
      try {
        const token = await getAuthToken();
        const result = await submitReview(card.reviewEventId, knew, token);
        setCardState({
          phase: "result",
          passed: result.passed,
          nextScheduledAt: result.nextScheduledAt,
        });
        setResults((prev) => [...prev, { passed: result.passed }]);
      } catch {
        setSubmitError("Failed to save your answer. Please try again.");
      }
    });
  }

  function handleNext() {
    if (isLastCard) {
      setCardIndex(cards.length);
    } else {
      setCardIndex((i) => i + 1);
      setCardState({ phase: "question" });
      setSubmitError(null);
    }
  }

  const globalCardIndex = completedCards + cardIndex;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <a
            href={`/learn/${enrollmentId}`}
            className="text-sm text-gray-500 hover:text-gray-700"
            title="Save and exit — your progress is saved"
          >
            Save &amp; exit
          </a>
          <span className="text-sm text-gray-400">
            {globalCardIndex + 1} / {totalCards}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mb-6 h-1.5 w-full rounded-full bg-gray-200">
          <div
            className="h-1.5 rounded-full bg-indigo-600 transition-all"
            style={{
              width: `${((globalCardIndex + (cardState.phase === "result" ? 1 : 0)) / totalCards) * 100}%`,
            }}
            role="progressbar"
            aria-valuenow={globalCardIndex + 1}
            aria-valuemin={1}
            aria-valuemax={totalCards}
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600">
            {card.type === "mcq" ? "Multiple choice" : "Flashcard"}
          </p>
          <h1 className="mb-6 text-lg font-semibold leading-snug text-gray-900">{card.front}</h1>

          {submitError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {submitError}
            </p>
          )}

          {/* ── MCQ question ─────────────────────────────────────────── */}
          {card.type === "mcq" && cardState.phase === "question" && card.options && (
            <div className="space-y-3" role="list" aria-label="Answer options">
              {card.options.map((option, index) => {
                const label = LETTER_LABELS[index] ?? String(index + 1);
                return (
                  <button
                    key={index}
                    onClick={() => handleMcqAnswer(index)}
                    disabled={isPending}
                    role="listitem"
                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-gray-800 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white"
                      aria-hidden="true"
                    >
                      {label}
                    </span>
                    {option}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── MCQ result ───────────────────────────────────────────── */}
          {card.type === "mcq" && cardState.phase === "result" && (
            <McqResult
              card={card}
              passed={cardState.passed}
              nextScheduledAt={cardState.nextScheduledAt}
              onNext={handleNext}
              isLastCard={isLastCard}
            />
          )}

          {/* ── Flashcard question ───────────────────────────────────── */}
          {card.type !== "mcq" && cardState.phase === "question" && (
            <div className="text-center">
              <button
                onClick={handleReveal}
                className="inline-block rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700"
              >
                Reveal Answer
              </button>
            </div>
          )}

          {/* ── Flashcard revealed ───────────────────────────────────── */}
          {card.type !== "mcq" && cardState.phase === "revealed" && (
            <>
              <div className="mb-6 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-500">
                  Answer
                </p>
                <p className="text-gray-800">{card.back}</p>
              </div>
              <p className="mb-4 text-sm font-medium text-gray-600">Did you know this?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleSelfAssess(true)}
                  disabled={isPending}
                  className="flex-1 rounded-lg border border-green-200 bg-green-50 px-4 py-3 font-medium text-green-800 transition-colors hover:bg-green-100 disabled:opacity-50"
                >
                  Yes, I knew it
                </button>
                <button
                  onClick={() => handleSelfAssess(false)}
                  disabled={isPending}
                  className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                >
                  No, I didn&rsquo;t
                </button>
              </div>
            </>
          )}

          {/* ── Flashcard result ─────────────────────────────────────── */}
          {card.type !== "mcq" && cardState.phase === "result" && (
            <FlashcardResult
              passed={cardState.passed}
              nextScheduledAt={cardState.nextScheduledAt}
              onNext={handleNext}
              isLastCard={isLastCard}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Result sub-views
// ---------------------------------------------------------------------------

interface McqResultProps {
  card: SessionCard;
  passed: boolean;
  nextScheduledAt: string | null;
  onNext: () => void;
  isLastCard: boolean;
}

function McqResult({ card, passed, nextScheduledAt, onNext, isLastCard }: McqResultProps) {
  const correctOption =
    card.correctOptionIndex !== null ? (card.options?.[card.correctOptionIndex] ?? null) : null;
  const nextDate = nextScheduledAt
    ? new Date(nextScheduledAt).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <>
      <div
        className={`mb-4 text-center text-4xl ${passed ? "text-green-500" : "text-amber-500"}`}
        aria-hidden="true"
      >
        {passed ? "✓" : "○"}
      </div>
      <p className="mb-4 text-center font-semibold text-gray-900">
        {passed ? "Correct!" : "Not quite"}
      </p>

      {!passed && correctOption && (
        <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-500">
            Correct answer
          </p>
          <p className="font-medium text-gray-800">{correctOption}</p>
        </div>
      )}

      <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 p-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
          Explanation
        </p>
        <p className="text-sm text-gray-700">{card.back}</p>
      </div>

      {nextDate && (
        <p className="mb-6 text-center text-sm text-gray-500">
          Next review: <strong>{nextDate}</strong>
        </p>
      )}

      <button
        onClick={onNext}
        className="w-full rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700"
      >
        {isLastCard ? "Finish session" : "Next card"}
      </button>
    </>
  );
}

interface FlashcardResultProps {
  passed: boolean;
  nextScheduledAt: string | null;
  onNext: () => void;
  isLastCard: boolean;
}

function FlashcardResult({ passed, nextScheduledAt, onNext, isLastCard }: FlashcardResultProps) {
  const nextDate = nextScheduledAt
    ? new Date(nextScheduledAt).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <>
      {nextDate && (
        <p className="mb-6 text-center text-sm text-gray-500">
          Next review: <strong>{nextDate}</strong>
          {!passed && <span className="ml-1 text-amber-600">(sooner — keep practicing!)</span>}
        </p>
      )}

      <button
        onClick={onNext}
        className="w-full rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700"
      >
        {isLastCard ? "Finish session" : "Next card"}
      </button>
    </>
  );
}
