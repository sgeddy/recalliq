"use client";

import { useState } from "react";

interface Domain {
  name: string;
  weightPercent: number;
}

interface ModuleItem {
  id: string;
  title: string;
  position: number;
  description: string | null;
  cardCount: number;
}

interface Props {
  modules: ModuleItem[];
  domains: Domain[] | null;
  label: string;
}

export function DomainCoverage({ modules, domains, label }: Props) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">{label}</h2>
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800"
          aria-expanded={isOpen}
        >
          {isOpen ? "Hide" : "Show"}
          <svg
            className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <ol className="space-y-3">
          {modules.length === 0 ? (
            <p className="text-gray-500">No modules available yet.</p>
          ) : (
            modules.map((mod, i) => {
              const domain = domains?.[i];
              return (
                <li key={mod.id} className="rounded-lg border border-gray-200 bg-white px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-sm font-medium text-gray-400">
                          {mod.position}.
                        </span>
                        <span className="font-medium text-gray-900">{mod.title}</span>
                        {domain && (
                          <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                            {domain.weightPercent}%
                          </span>
                        )}
                      </div>
                      {mod.description && (
                        <p className="mt-1 pl-5 text-sm text-gray-500">{mod.description}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm text-gray-500">
                      {mod.cardCount} {mod.cardCount === 1 ? "question" : "questions"}
                    </span>
                  </div>
                </li>
              );
            })
          )}
        </ol>
      )}
    </section>
  );
}
