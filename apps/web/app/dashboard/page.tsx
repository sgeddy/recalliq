import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Dashboard" };

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

interface EnrollmentSummary {
  id: string;
  status: string;
  createdAt: string;
  examDate: string | null;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  totalCards: number;
  completedReviews: number;
  hasDueCards: boolean;
  nextSessionAt: string | null;
  preparednessScore: number;
}

async function fetchEnrollments(authToken: string): Promise<EnrollmentSummary[]> {
  const res = await fetch(`${API_URL}/enrollments`, {
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: EnrollmentSummary[] };
  return json.data;
}

function preparednessDisplay(score: number): { label: string; colorClass: string } {
  if (score >= 90) return { label: "Exam-ready", colorClass: "text-indigo-700" };
  if (score >= 75) return { label: "Solid", colorClass: "text-green-700" };
  if (score >= 50) return { label: "Building", colorClass: "text-amber-700" };
  return { label: "Beginner", colorClass: "text-red-700" };
}

function barColorClass(score: number): string {
  if (score >= 90) return "bg-indigo-500";
  if (score >= 75) return "bg-green-500";
  if (score >= 50) return "bg-amber-500";
  if (score > 0) return "bg-red-400";
  return "bg-gray-200";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const { getToken } = auth();
  const authToken = await getToken();

  if (!authToken) {
    redirect("/sign-in");
  }

  const enrollments = await fetchEnrollments(authToken);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">My Dashboard</h1>
        <p className="mt-2 text-gray-600">Your active courses and study progress.</p>
      </div>

      {enrollments.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-8 py-12 text-center">
          <p className="mb-2 text-lg font-semibold text-gray-800">
            You haven&rsquo;t enrolled yet.
          </p>
          <p className="mb-6 text-gray-500">
            Browse the course catalog and start your first learning plan.
          </p>
          <a
            href="/courses"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Browse courses
          </a>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {enrollments.map((e) => {
            const { label, colorClass } = preparednessDisplay(e.preparednessScore);

            return (
              <li key={e.id}>
                <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  {/* Header */}
                  <div className="mb-4 flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-gray-900">{e.courseTitle}</h2>
                    {e.hasDueCards ? (
                      <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                        Due now
                      </span>
                    ) : (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                          e.status === "active"
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {e.status}
                      </span>
                    )}
                  </div>

                  {/* Preparedness score */}
                  <div className="mb-4">
                    <div className="mb-1.5 flex justify-between text-xs text-gray-500">
                      <span>Preparedness</span>
                      <span className={`font-semibold ${colorClass}`}>
                        {e.preparednessScore > 0
                          ? `${e.preparednessScore}% · ${label}`
                          : "Not started"}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-2 rounded-full transition-all ${barColorClass(e.preparednessScore)}`}
                        style={{ width: `${e.preparednessScore}%` }}
                      />
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="mb-5 space-y-1 text-xs text-gray-500">
                    <p>Enrolled {fmtDate(e.createdAt)}</p>
                    {e.examDate && <p>Exam: {fmtDate(e.examDate)}</p>}
                    {!e.hasDueCards && e.nextSessionAt && (
                      <p>Next session: {fmtDateShort(e.nextSessionAt)}</p>
                    )}
                  </div>

                  {/* CTA */}
                  <div className="mt-auto flex gap-2">
                    <a
                      href={`/learn/${e.id}`}
                      className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      {e.hasDueCards ? "Start session" : "View dashboard"}
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8">
        <a href="/courses" className="text-sm text-indigo-600 hover:underline">
          + Browse more courses
        </a>
      </div>
    </div>
  );
}
