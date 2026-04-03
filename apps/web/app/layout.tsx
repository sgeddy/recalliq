import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s | RecallIQ",
    default: "RecallIQ",
  },
  description: "Master any subject with AI-powered spaced repetition.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
          <header className="border-b border-gray-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
              <a href="/courses" className="text-xl font-bold text-brand-700">
                RecallIQ
              </a>
              <nav className="flex items-center gap-4">
                <a href="/courses" className="text-sm text-gray-600 hover:text-gray-900">
                  Courses
                </a>
                <a
                  href="/sign-in"
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  Sign in
                </a>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
