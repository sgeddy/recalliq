"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

interface EnrollButtonProps {
  courseId: string;
}

type State = "checking" | "idle" | "loading" | "success" | "error";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

export function EnrollButton({ courseId }: EnrollButtonProps) {
  const { isSignedIn, getToken } = useAuth();
  const [state, setState] = useState<State>("checking");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setState("idle");
      return;
    }

    let cancelled = false;

    async function checkEnrollment() {
      try {
        const token = await getToken();
        const res = await fetch(
          `${API_URL}/enrollments/active?courseId=${encodeURIComponent(courseId)}`,
          { headers: { Authorization: `Bearer ${token ?? ""}` } },
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { data: { enrollmentId: string } | null };
        if (cancelled) return;
        if (json.data) {
          setEnrollmentId(json.data.enrollmentId);
          setState("success");
        } else {
          setState("idle");
        }
      } catch {
        if (!cancelled) setState("idle");
      }
    }

    void checkEnrollment();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, courseId]);

  if (!isSignedIn) {
    return (
      <a
        href="/sign-in"
        className="inline-block rounded-md bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
      >
        Sign in to enroll
      </a>
    );
  }

  if (state === "checking") {
    return <div className="h-11 w-48 animate-pulse rounded-md bg-gray-200" aria-label="Loading…" />;
  }

  if (state === "success" && enrollmentId) {
    return (
      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-6 py-5">
        <p className="mb-3 font-medium text-indigo-900">You&rsquo;re enrolled in this course.</p>
        <a
          href={`/learn/${enrollmentId}`}
          className="inline-block rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
        >
          Go to my dashboard
        </a>
      </div>
    );
  }

  async function handleEnroll() {
    setState("loading");
    setErrorMsg(null);

    try {
      const token = await getToken();

      const res = await fetch(`${API_URL}/enrollments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          courseId,
          goalType: "long_term",
          channels: ["email"],
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }

      const json = (await res.json()) as { data: { id: string } };
      setEnrollmentId(json.data.id);
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  return (
    <div>
      {state === "success" && enrollmentId ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-6 py-5">
          <p className="mb-3 font-medium text-green-800">You&rsquo;re enrolled!</p>
          <a
            href={`/learn/${enrollmentId}`}
            className="inline-block rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700"
          >
            Go to my dashboard
          </a>
          <p className="mt-3 text-sm text-green-700">
            Or we&rsquo;ll email you a link when your first session is ready.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={handleEnroll}
            disabled={state === "loading"}
            className="inline-block rounded-md bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {state === "loading" ? "Enrolling…" : "Enroll and start learning"}
          </button>
          {state === "error" && errorMsg && <p className="mt-2 text-sm text-red-600">{errorMsg}</p>}
        </>
      )}
    </div>
  );
}
