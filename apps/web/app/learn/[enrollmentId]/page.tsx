import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { certConfigs } from "@recalliq/types";

import { EnrollmentDashboard } from "./EnrollmentDashboard";
import type { DashboardData } from "./EnrollmentDashboard";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

async function fetchDashboard(
  enrollmentId: string,
  authToken: string,
): Promise<DashboardData | null> {
  const res = await fetch(`${API_URL}/enrollments/${enrollmentId}/dashboard`, {
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch dashboard: ${res.status}`);

  const json = (await res.json()) as { data: DashboardData };
  return json.data;
}

interface PageProps {
  params: { enrollmentId: string };
}

export default async function LearnPage({ params }: PageProps) {
  const { getToken } = auth();
  const authToken = await getToken();

  if (!authToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Sign in required</h1>
          <p className="mb-6 text-gray-500">You must be signed in to view your dashboard.</p>
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

  const data = await fetchDashboard(params.enrollmentId, authToken);
  if (!data) notFound();

  // Merge cert domain weights into the domain rows so the client doesn't
  // need to re-import certConfigs (avoids a large bundle inclusion).
  const certConfig = certConfigs[data.course.slug] ?? null;
  const domainsWithWeights = data.domains.map((d) => ({
    ...d,
    weightPercent: certConfig?.domains[d.modulePosition - 1]?.weightPercent ?? null,
  }));

  return <EnrollmentDashboard {...data} domains={domainsWithWeights} certConfig={certConfig} />;
}
