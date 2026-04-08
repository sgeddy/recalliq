import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";

import type { CourseWithStats } from "@recalliq/types";

export const metadata: Metadata = {
  title: "Courses",
};

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: "bg-green-100 text-green-800",
  intermediate: "bg-yellow-100 text-yellow-800",
  advanced: "bg-red-100 text-red-800",
};

interface EnrollmentSummary {
  courseId: string;
  id: string;
}

async function fetchPublishedCourses(): Promise<CourseWithStats[]> {
  const res = await fetch(`${API_URL}/courses`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Failed to fetch courses: ${res.status}`);
  const json = (await res.json()) as { data: CourseWithStats[] };
  return json.data;
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

export default async function CoursesPage() {
  const { getToken } = auth();
  const authToken = await getToken();

  let courses: CourseWithStats[] = [];
  let fetchError: string | null = null;
  const enrollmentsByCourseId = new Map<string, string>(); // courseId → enrollmentId

  try {
    courses = await fetchPublishedCourses();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Failed to load courses";
  }

  if (authToken) {
    const enrollments = await fetchEnrollments(authToken);
    for (const e of enrollments) {
      enrollmentsByCourseId.set(e.courseId, e.id);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Course Catalog</h1>
        <p className="mt-2 text-gray-600">
          Master any certification with AI-powered spaced repetition.
        </p>
      </div>

      {fetchError ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">
          {fetchError}
        </div>
      ) : courses.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white p-8 text-center text-gray-500">
          No courses available yet.
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => {
            const enrollmentId = enrollmentsByCourseId.get(course.id);
            const isEnrolled = Boolean(enrollmentId);

            return (
              <li key={course.id}>
                <div
                  className={`flex h-full flex-col rounded-lg border bg-white p-6 shadow-sm transition hover:shadow-md ${
                    isEnrolled ? "border-indigo-200" : "border-gray-200"
                  }`}
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="text-lg font-semibold text-gray-900">{course.title}</h2>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isEnrolled && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          Enrolled
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          DIFFICULTY_COLORS[course.difficulty] ?? "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {DIFFICULTY_LABELS[course.difficulty] ?? course.difficulty}
                      </span>
                    </div>
                  </div>

                  {course.description && (
                    <p className="mb-4 line-clamp-2 text-sm text-gray-600">{course.description}</p>
                  )}

                  <div className="mb-5 flex items-center gap-4 text-xs text-gray-500">
                    <span>{course.moduleCount} modules</span>
                    <span>·</span>
                    <span className="capitalize">{course.category}</span>
                  </div>

                  <div className="mt-auto flex gap-2">
                    {isEnrolled ? (
                      <a
                        href={`/learn/${enrollmentId}`}
                        className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        Go to dashboard
                      </a>
                    ) : (
                      <a
                        href={`/courses/${course.slug}`}
                        className="flex-1 rounded-md border border-gray-200 px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        View course
                      </a>
                    )}
                    {isEnrolled && (
                      <a
                        href={`/courses/${course.slug}`}
                        className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
                        title="Course details"
                      >
                        Details
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
