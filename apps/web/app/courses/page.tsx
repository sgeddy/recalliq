import type { Metadata } from "next";

import type { CourseWithStats } from "@recalliq/types";

export const metadata: Metadata = {
  title: "Courses",
};

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

async function fetchPublishedCourses(): Promise<CourseWithStats[]> {
  const apiUrl = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

  const res = await fetch(`${apiUrl}/courses`, {
    // Revalidate every 60 seconds — course list doesn't change often
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch courses: ${res.status}`);
  }

  const json = (await res.json()) as { data: CourseWithStats[] };
  return json.data;
}

export default async function CoursesPage() {
  let courses: CourseWithStats[] = [];
  let fetchError: string | null = null;

  try {
    courses = await fetchPublishedCourses();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Failed to load courses";
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Courses</h1>
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
          {courses.map((course) => (
            <li key={course.id}>
              <a
                href={`/courses/${course.slug}`}
                className="block rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">{course.title}</h2>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      DIFFICULTY_COLORS[course.difficulty] ?? "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {DIFFICULTY_LABELS[course.difficulty] ?? course.difficulty}
                  </span>
                </div>

                {course.description && (
                  <p className="mb-4 text-sm text-gray-600 line-clamp-2">
                    {course.description}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{course.moduleCount} modules</span>
                  <span>·</span>
                  <span className="capitalize">{course.category}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
