"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter, useParams } from "next/navigation";

import type { GeneratedCourse, GeneratedModule } from "@recalliq/types";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

type UploadStatus = "pending" | "processing" | "review" | "confirmed" | "failed";

interface UploadData {
  id: string;
  title: string | null;
  status: UploadStatus;
  generatedPayload: GeneratedCourse | null;
  courseId: string | null;
  errorMessage: string | null;
  sources: { id: string; sourceType: string; name: string }[];
}

export default function UploadReviewPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const params = useParams();
  const uploadId = params.uploadId as string;

  const [upload, setUpload] = useState<UploadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<number>>(new Set());

  const fetchUpload = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API_URL}/uploads/${uploadId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setError("Failed to load upload");
        setIsLoading(false);
        return;
      }

      const { data } = (await res.json()) as { data: UploadData };
      setUpload(data);
      setIsLoading(false);
    } catch {
      setError("Failed to load upload");
      setIsLoading(false);
    }
  }, [getToken, uploadId]);

  useEffect(() => {
    fetchUpload();
  }, [fetchUpload]);

  // Poll while pending/processing
  useEffect(() => {
    if (!upload) return;
    if (upload.status !== "pending" && upload.status !== "processing") return;

    const interval = setInterval(fetchUpload, 3000);
    return () => clearInterval(interval);
  }, [upload?.status, fetchUpload]);

  // Redirect on confirmed
  useEffect(() => {
    if (upload?.status === "confirmed" && upload.courseId) {
      // Find the enrollment for this course — for now go to dashboard
      router.push("/dashboard");
    }
  }, [upload?.status, upload?.courseId, router]);

  async function handleConfirm() {
    setIsConfirming(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`${API_URL}/uploads/${uploadId}/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Confirm failed: ${res.status}`);
      }

      const { data } = (await res.json()) as {
        data: { courseId: string; enrollmentId: string };
      };

      router.push(`/learn/${data.enrollmentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
      setIsConfirming(false);
    }
  }

  function toggleModule(index: number) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  if (isLoading) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-4xl">...</div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </main>
    );
  }

  if (error && !upload) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  if (!upload) return null;

  // Pending / Processing state
  if (upload.status === "pending" || upload.status === "processing") {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-indigo-600" />
          </div>
          <h1 className="mb-2 text-xl font-semibold text-gray-900">
            {upload.status === "pending" ? "Preparing..." : "Generating your study plan..."}
          </h1>
          <p className="mb-6 text-gray-500">
            AI is analyzing your materials and creating practice questions. This usually takes 30-60
            seconds.
          </p>
          {upload.sources.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 text-left">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Sources ({upload.sources.length})
              </p>
              {upload.sources.map((s) => (
                <p key={s.id} className="truncate text-sm text-gray-700">
                  {s.sourceType === "url" ? s.name : s.name}
                </p>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  // Failed state
  if (upload.status === "failed") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <div className="mb-4 text-4xl">!</div>
        <h1 className="mb-2 text-xl font-semibold text-gray-900">Processing Failed</h1>
        <p className="mb-6 text-gray-500">
          {upload.errorMessage ?? "An unexpected error occurred"}
        </p>
        <a
          href="/upload"
          className="inline-block rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
        >
          Try Again
        </a>
      </main>
    );
  }

  // Review state
  const generated = upload.generatedPayload;
  if (!generated) return null;

  const totalCards = generated.modules.reduce((sum, m) => sum + m.cards.length, 0);
  const mcqCount = generated.modules.reduce(
    (sum, m) => sum + m.cards.filter((c) => c.type === "mcq").length,
    0,
  );
  const flashcardCount = generated.modules.reduce(
    (sum, m) => sum + m.cards.filter((c) => c.type === "flashcard").length,
    0,
  );
  const freeRecallCount = totalCards - mcqCount - flashcardCount;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-indigo-600">
        Review Generated Course
      </p>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">{generated.title}</h1>
      <p className="mb-6 text-gray-500">{generated.description}</p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{generated.modules.length}</p>
          <p className="text-xs text-gray-500">modules</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{totalCards}</p>
          <p className="text-xs text-gray-500">total cards</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{mcqCount}</p>
          <p className="text-xs text-gray-500">multiple choice</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{flashcardCount + freeRecallCount}</p>
          <p className="text-xs text-gray-500">flashcards</p>
        </div>
      </div>

      {/* Modules */}
      <div className="mb-8 space-y-3">
        {generated.modules.map((mod: GeneratedModule, i: number) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white">
            <button
              onClick={() => toggleModule(i)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
            >
              <div>
                <h2 className="font-semibold text-gray-900">{mod.title}</h2>
                <p className="text-sm text-gray-500">
                  {mod.cards.length} card{mod.cards.length !== 1 ? "s" : ""}
                  {mod.description ? ` — ${mod.description}` : ""}
                </p>
              </div>
              <span className="ml-2 text-gray-400">{expandedModules.has(i) ? "−" : "+"}</span>
            </button>

            {expandedModules.has(i) && (
              <div className="border-t border-gray-100 px-5 py-3">
                <div className="space-y-3">
                  {mod.cards.map((card, j) => (
                    <div key={j} className="rounded-lg bg-gray-50 p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={[
                            "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                            card.type === "mcq"
                              ? "bg-blue-100 text-blue-700"
                              : card.type === "flashcard"
                                ? "bg-green-100 text-green-700"
                                : "bg-amber-100 text-amber-700",
                          ].join(" ")}
                        >
                          {card.type === "mcq"
                            ? card.correctOptionIndices
                              ? `Select ${card.correctOptionIndices.length}`
                              : "MCQ"
                            : card.type === "flashcard"
                              ? "Flashcard"
                              : "Free Recall"}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-800">{card.front}</p>
                      {card.options && (
                        <div className="mt-2 space-y-1">
                          {card.options.map((opt, k) => {
                            const isCorrect = card.correctOptionIndices
                              ? card.correctOptionIndices.includes(k)
                              : card.correctOptionIndex === k;
                            return (
                              <p
                                key={k}
                                className={[
                                  "text-xs",
                                  isCorrect ? "font-medium text-green-700" : "text-gray-600",
                                ].join(" ")}
                              >
                                {String.fromCharCode(65 + k)}. {opt}
                                {isCorrect ? " ✓" : ""}
                              </p>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Confirm */}
      <div className="flex gap-3">
        <button
          onClick={handleConfirm}
          disabled={isConfirming}
          className="flex-1 rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {isConfirming ? "Creating course..." : "Confirm & Start Studying"}
        </button>
        <a
          href="/upload"
          className="rounded-lg border border-gray-200 px-5 py-3 font-medium text-gray-600 hover:bg-gray-50"
        >
          Start Over
        </a>
      </div>
    </main>
  );
}
