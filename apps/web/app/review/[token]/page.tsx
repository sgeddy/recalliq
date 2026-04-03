import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

const LETTER_LABELS = ["A", "B", "C", "D", "E", "F"] as const;

interface Card {
  id: string;
  type: "flashcard" | "mcq" | "free_recall";
  front: string;
  back: string;
  options: string[] | null;
  correctOptionIndex: number | null;
}

interface ReviewEvent {
  id: string;
  cardId: string;
  intervalIndex: number;
  scheduledAt: string;
  completedAt: string | null;
  passed: boolean | null;
}

interface ReviewData {
  reviewEvent: ReviewEvent;
  card: Card;
}

interface PageProps {
  params: { token: string };
  searchParams: { answer?: string; revealed?: string };
}

async function fetchReviewData(token: string, authToken: string): Promise<ReviewData | null> {
  const res = await fetch(`${API_URL}/reviews/${token}`, {
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch review: ${res.status}`);

  const json = (await res.json()) as { data: ReviewData };
  return json.data;
}

async function submitReview(
  token: string,
  passed: boolean,
  authToken: string,
): Promise<{ passed: boolean; nextScheduledAt: string | null; completed: boolean }> {
  const res = await fetch(`${API_URL}/reviews/${token}/submit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ passed }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Failed to submit review: ${res.status}`);

  const json = (await res.json()) as {
    data: { passed: boolean; nextScheduledAt: string | null; completed: boolean };
  };
  return json.data;
}

export default async function ReviewPage({ params, searchParams }: PageProps) {
  const { getToken } = auth();
  const authToken = await getToken();

  if (!authToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Sign in required</h1>
          <p className="mb-6 text-gray-500">You must be signed in to view this review.</p>
          <a
            href="/sign-in"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Sign in
          </a>
        </div>
      </main>
    );
  }

  const token = params.token;
  const answerParam = searchParams.answer;
  const revealedParam = searchParams.revealed;

  const data = await fetchReviewData(token, authToken);

  if (!data) notFound();

  const { reviewEvent, card } = data;

  if (reviewEvent.completedAt !== null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="text-center text-gray-500">This review has already been completed.</p>
          <div className="mt-6 text-center">
            <a href="/courses" className="text-sm text-indigo-600 hover:underline">
              Back to courses
            </a>
          </div>
        </div>
      </main>
    );
  }

  const reviewUrl = `/review/${encodeURIComponent(token)}`;

  // ── Submit path: ?answer=X ────────────────────────────────────────────────
  if (answerParam !== undefined) {
    const answerIndex = parseInt(answerParam, 10);
    const isValidIndex = !Number.isNaN(answerIndex) && answerIndex >= 0;

    let passed: boolean;
    if (card.type === "mcq" && card.correctOptionIndex !== null) {
      passed = isValidIndex && answerIndex === card.correctOptionIndex;
    } else {
      // Flashcard self-assessment: answer=1 → knew it (pass), answer=0 → didn't know (fail)
      passed = answerIndex === 1;
    }

    let result: { passed: boolean; nextScheduledAt: string | null; completed: boolean } | null =
      null;
    try {
      result = await submitReview(token, passed, authToken);
    } catch {
      // Already submitted or other error — show neutral result
    }

    const correctOption =
      card.type === "mcq" && card.correctOptionIndex !== null
        ? (card.options?.[card.correctOptionIndex] ?? null)
        : null;

    return (
      <SubmittedView
        passed={result?.passed ?? passed}
        nextScheduledAt={result?.nextScheduledAt ?? null}
        explanation={card.back}
        correctOption={correctOption}
        selectedIndex={isValidIndex ? answerIndex : null}
        correctOptionIndex={card.correctOptionIndex}
      />
    );
  }

  // ── Reveal path: ?revealed=true (flashcard only) ──────────────────────────
  if (revealedParam === "true" && card.type !== "mcq") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg">
          <div className="mb-6">
            <a href="/courses" className="text-sm text-indigo-600 hover:underline">
              ← Back to courses
            </a>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600">
              Question
            </p>
            <h1 className="mb-6 text-lg font-semibold leading-snug text-gray-900">{card.front}</h1>

            <div className="mb-6 rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-500">
                Answer
              </p>
              <p className="text-gray-800">{card.back}</p>
            </div>

            <p className="mb-4 text-sm font-medium text-gray-600">Did you know this?</p>
            <div className="flex gap-3">
              <a
                href={`${reviewUrl}?answer=1`}
                className="flex-1 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-center font-medium text-green-800 transition-colors hover:bg-green-100"
              >
                Yes, I knew it
              </a>
              <a
                href={`${reviewUrl}?answer=0`}
                className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center font-medium text-amber-800 transition-colors hover:bg-amber-100"
              >
                No, I didn&rsquo;t
              </a>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Question path: show question ──────────────────────────────────────────
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <a href="/courses" className="text-sm text-indigo-600 hover:underline">
            ← Back to courses
          </a>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600">
            {card.type === "mcq" ? "Multiple choice" : "Flashcard"}
          </p>
          <h1 className="mb-6 text-lg font-semibold leading-snug text-gray-900">{card.front}</h1>

          {card.type === "mcq" && card.options && card.options.length > 0 ? (
            <div className="space-y-3" role="list" aria-label="Answer options">
              {card.options.map((option, index) => {
                const label = LETTER_LABELS[index] ?? String(index + 1);
                return (
                  <a
                    key={index}
                    href={`${reviewUrl}?answer=${index}`}
                    role="listitem"
                    className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-gray-800 transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white"
                      aria-hidden="true"
                    >
                      {label}
                    </span>
                    {option}
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="text-center">
              <a
                href={`${reviewUrl}?revealed=true`}
                className="inline-block rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-700"
              >
                Reveal Answer
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Result screen shown after submission
// ---------------------------------------------------------------------------

interface SubmittedViewProps {
  passed: boolean;
  nextScheduledAt: string | null;
  explanation: string;
  correctOption: string | null;
  selectedIndex: number | null;
  correctOptionIndex: number | null;
}

function SubmittedView({
  passed,
  nextScheduledAt,
  explanation,
  correctOption,
  selectedIndex,
  correctOptionIndex,
}: SubmittedViewProps) {
  const nextDate = nextScheduledAt
    ? new Date(nextScheduledAt).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const isMcq = correctOptionIndex !== null;
  const wasWrong = isMcq && !passed && correctOption;

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div
          className={`mb-4 text-5xl text-center ${passed ? "text-green-500" : "text-amber-500"}`}
          aria-hidden="true"
        >
          {passed ? "✓" : "○"}
        </div>

        <h1 className="mb-4 text-center text-xl font-semibold text-gray-900">
          {passed ? "Nice work!" : "Keep going!"}
        </h1>

        {wasWrong && (
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
          <p className="text-sm text-gray-700">{explanation}</p>
        </div>

        {nextDate ? (
          <p className="mb-6 text-center text-gray-500">
            Your next review is scheduled for <strong>{nextDate}</strong>.
          </p>
        ) : (
          <p className="mb-6 text-center text-gray-500">Your next review has been scheduled.</p>
        )}

        <div className="text-center">
          <a
            href="/courses"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Back to courses
          </a>
        </div>
      </div>
    </main>
  );
}
