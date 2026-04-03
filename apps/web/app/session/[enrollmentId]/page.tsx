import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { SessionQuiz } from "./SessionQuiz";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export interface SessionCard {
  reviewEventId: string;
  intervalIndex: number;
  cardId: string;
  type: "flashcard" | "mcq" | "free_recall";
  front: string;
  back: string;
  options: string[] | null;
  correctOptionIndex: number | null;
}

interface SessionData {
  enrollmentId: string;
  courseTitle: string;
  totalCards: number;
  completedCards: number;
  cards: SessionCard[];
}

async function fetchSession(enrollmentId: string, authToken: string): Promise<SessionData | null> {
  const res = await fetch(`${API_URL}/enrollments/${enrollmentId}/session`, {
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch session: ${res.status}`);

  const json = (await res.json()) as { data: SessionData };
  return json.data;
}

interface PageProps {
  params: { enrollmentId: string };
}

export default async function SessionPage({ params }: PageProps) {
  const { getToken } = auth();
  const authToken = await getToken();

  if (!authToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Sign in required</h1>
          <p className="mb-6 text-gray-500">You must be signed in to start this session.</p>
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

  const session = await fetchSession(params.enrollmentId, authToken);

  if (!session) notFound();

  // Best-effort: cancel the pending email reminder now that the user started in-app.
  // Errors here are non-fatal — session loading must not be blocked.
  try {
    await fetch(`${API_URL}/enrollments/${params.enrollmentId}/session/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    });
  } catch {
    // Non-blocking
  }

  if (session.cards.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mb-4 text-5xl">✓</div>
          <h1 className="mb-2 text-xl font-semibold text-gray-900">All caught up!</h1>
          <p className="mb-6 text-gray-500">
            No cards are due for <strong>{session.courseTitle}</strong> right now. Check back later.
          </p>
          <a
            href="/courses"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Back to courses
          </a>
        </div>
      </main>
    );
  }

  return (
    <SessionQuiz
      enrollmentId={session.enrollmentId}
      courseTitle={session.courseTitle}
      totalCards={session.totalCards}
      completedCards={session.completedCards}
      cards={session.cards}
    />
  );
}
