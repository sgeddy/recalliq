import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { buildGenericCertConfig, certConfigs } from "@recalliq/types";

import { DomainCoverage } from "./DomainCoverage";
import { EnrollButton } from "./EnrollButton";
import { StudyPlanCalculator } from "./StudyPlanCalculator";

interface CourseModule {
  id: string;
  title: string;
  position: number;
  description: string | null;
  cardCount: number;
}

interface CourseDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  difficulty: string;
  passMark: number;
  defaultIntervals: number[];
  moduleCount: number;
  cardCount: number;
  modules: CourseModule[];
}

interface PageProps {
  params: { slug: string };
}

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

async function fetchCourse(slug: string): Promise<CourseDetail | null> {
  const res = await fetch(`${API_URL}/courses/${slug}`, {
    next: { revalidate: 60 },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`Failed to fetch course: ${res.status}`);
  }

  const json = (await res.json()) as { data: CourseDetail };
  return json.data;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const course = await fetchCourse(params.slug);

  return {
    title: course?.title ?? "Course not found",
    description: course?.description ?? null,
  };
}

export default async function CourseDetailPage({ params }: PageProps) {
  const course = await fetchCourse(params.slug);

  if (!course) {
    notFound();
  }

  // Registered cert config drives the official exam overview + compliance UI.
  // User-generated courses get a generic equal-weighted config that is only
  // used to feed the study plan calculator.
  const certConfig = certConfigs[course.slug];
  const planCertConfig =
    certConfig ??
    buildGenericCertConfig({
      slug: course.slug,
      title: course.title,
      moduleNames: [...course.modules].sort((a, b) => a.position - b.position).map((m) => m.title),
      questionPoolSize: course.cardCount,
    });

  // Derive display strings from the structured config
  const passingScoreDisplay = certConfig
    ? `${certConfig.passingScore.scaled} / ${certConfig.passingScore.scaleMax}`
    : null;

  const questionTypesDisplay = certConfig
    ? certConfig.questionTypes
        .map(
          (t) =>
            ({
              mcq: "Multiple choice",
              pbq: "Performance-based (PBQ)",
              "drag-drop": "Drag and drop",
              matching: "Matching",
              hotspot: "Hotspot",
              "case-study": "Case study",
              essay: "Essay",
            })[t] ?? t,
        )
        .join(" & ")
    : null;

  return (
    <div>
      <div className="mb-2">
        <a href="/courses" className="text-sm text-indigo-600 hover:underline">
          ← Back to courses
        </a>
      </div>

      {/* Course header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">{course.title}</h1>
        {course.description && <p className="mt-3 max-w-2xl text-gray-600">{course.description}</p>}
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500">
          <span className="capitalize">{course.category}</span>
          <span>·</span>
          <span className="capitalize">{course.difficulty}</span>
          <span>·</span>
          <span>Pass mark: {course.passMark}%</span>
          {certConfig && (
            <>
              <span>·</span>
              <span>{certConfig.examCode}</span>
            </>
          )}
        </div>
      </div>

      {/* Exam overview — shown for certification courses with a config */}
      {certConfig && (
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Exam Overview</h2>

          {/* Key stats */}
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{certConfig.maxQuestions}</p>
              <p className="mt-1 text-xs text-gray-500">Max questions</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{certConfig.durationMinutes}</p>
              <p className="mt-1 text-xs text-gray-500">Minutes</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{passingScoreDisplay}</p>
              <p className="mt-1 text-xs text-gray-500">Passing score</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">
                {certConfig.questionPoolSize ?? course.cardCount}
              </p>
              <p className="mt-1 text-xs text-gray-500">Practice questions</p>
            </div>
          </div>

          <div className="mb-3 rounded-lg border border-gray-200 bg-white px-5 py-3 text-sm text-gray-600">
            <strong>Question formats:</strong> {questionTypesDisplay}
          </div>

          {/* Compliance badges */}
          {(certConfig.dod8570Categories ?? certConfig.iso17024Accredited) && (
            <div className="flex flex-wrap gap-2">
              {certConfig.iso17024Accredited && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
                  ISO/IEC 17024 Accredited
                </span>
              )}
              {certConfig.dod8570Categories && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
                  DoD 8570 / 8140 Approved
                </span>
              )}
              {certConfig.certValidityYears && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
                  Valid {certConfig.certValidityYears} years
                </span>
              )}
              {certConfig.examCostUsd && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600">
                  ${certConfig.examCostUsd} exam fee
                </span>
              )}
            </div>
          )}
        </section>
      )}

      <DomainCoverage
        modules={course.modules}
        domains={certConfig?.domains ?? null}
        label={certConfig ? "Domain Coverage" : "Modules"}
      />

      <section className="mb-10">
        <StudyPlanCalculator certConfig={planCertConfig} />
      </section>

      <div>
        <EnrollButton courseId={course.id} />
      </div>
    </div>
  );
}
