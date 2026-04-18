"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

const ACCEPTED_EXTENSIONS = ".pdf,.docx,.txt,.md";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [contentType, setContentType] = useState<"practice_exam" | "study_guide" | "mixed">(
    "practice_exam",
  );
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const valid: File[] = [];
    for (const file of Array.from(newFiles)) {
      if (!ACCEPTED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|txt|md)$/i)) {
        setError(`Unsupported file type: ${file.name}. Allowed: PDF, DOCX, TXT, MD`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`${file.name} is too large (${formatFileSize(file.size)}). Max 5 MB.`);
        return;
      }
      valid.push(file);
    }
    setError(null);
    setFiles((prev) => [...prev, ...valid]);
  }, []);

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function addUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    try {
      new URL(trimmed);
    } catch {
      setError("Please enter a valid URL");
      return;
    }

    setError(null);
    setUrls((prev) => [...prev, trimmed]);
    setUrlInput("");
  }

  function removeUrl(index: number) {
    setUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (files.length === 0 && urls.length === 0) {
      setError("Add at least one file or URL");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const token = await getToken();
      console.log("[upload] token obtained:", !!token);
      if (!token) throw new Error("Not authenticated");

      // Send files and URLs together in one multipart request
      const formData = new FormData();
      formData.append("contentType", contentType);
      for (const file of files) {
        formData.append("file", file);
      }
      for (const url of urls) {
        formData.append("url", url);
      }

      console.log(
        "[upload] POST %s/uploads — files: %d, urls: %d",
        API_URL,
        files.length,
        urls.length,
      );
      const res = await fetch(`${API_URL}/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      console.log("[upload] response status:", res.status);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("[upload] error body:", body);
        throw new Error(body?.message ?? `Upload failed: ${res.status}`);
      }

      const { data } = (await res.json()) as { data: { uploadId: string } };
      console.log("[upload] success — uploadId:", data.uploadId);
      router.push(`/upload/${data.uploadId}`);
    } catch (err) {
      console.error("[upload] failed:", err);
      setError(err instanceof Error ? err.message : "Upload failed");
      setIsUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Create a Course</h1>
      <p className="mb-8 text-gray-500">
        Upload study materials and AI will generate a personalized study plan with practice
        questions.
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* File drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={[
          "mb-6 cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          isDragOver
            ? "border-indigo-400 bg-indigo-50"
            : "border-gray-300 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/50",
        ].join(" ")}
      >
        <div className="mb-2 text-3xl text-gray-400">+</div>
        <p className="mb-1 font-medium text-gray-700">Drop files here or click to browse</p>
        <p className="text-sm text-gray-500">PDF, DOCX, TXT, MD — up to 50 MB each</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* Selected files list */}
      {files.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Files ({files.length})
          </h2>
          <div className="space-y-2">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                </div>
                <button
                  onClick={() => removeFile(i)}
                  className="ml-3 text-sm text-red-500 hover:text-red-700"
                  aria-label={`Remove ${file.name}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* URL input */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Add URLs (optional)
        </h2>
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addUrl();
              }
            }}
            placeholder="https://example.com/study-guide"
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={addUrl}
            type="button"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Add
          </button>
        </div>
        {urls.length > 0 && (
          <div className="mt-3 space-y-2">
            {urls.map((url, i) => (
              <div
                key={`${url}-${i}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2"
              >
                <p className="min-w-0 flex-1 truncate text-sm text-gray-800">{url}</p>
                <button
                  onClick={() => removeUrl(i)}
                  className="ml-3 text-sm text-red-500 hover:text-red-700"
                  aria-label={`Remove ${url}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content type */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Content Type
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { value: "practice_exam", label: "Practice Exam", desc: "Questions with answers" },
              { value: "study_guide", label: "Study Guide", desc: "Notes, outlines, concepts" },
              { value: "mixed", label: "Mixed", desc: "Both questions and notes" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setContentType(opt.value)}
              className={[
                "rounded-lg border px-3 py-3 text-left transition-colors",
                contentType === opt.value
                  ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                  : "border-gray-200 bg-white hover:border-gray-300",
              ].join(" ")}
            >
              <p className="text-sm font-medium text-gray-900">{opt.label}</p>
              <p className="text-xs text-gray-500">{opt.desc}</p>
            </button>
          ))}
        </div>
        {contentType !== "practice_exam" && (
          <p className="mt-2 text-xs text-amber-600">
            Study guides use a more powerful AI model to generate questions from your content. This
            takes longer (2-5 minutes) but produces higher quality results.
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={isUploading || (files.length === 0 && urls.length === 0)}
        className="w-full rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isUploading ? "Uploading..." : "Generate Study Plan"}
      </button>
    </main>
  );
}
