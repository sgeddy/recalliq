"use client";

import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export function NavBar() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <a href="/" className="text-xl font-bold text-brand-700">
          RecallIQ
        </a>

        <nav className="flex items-center gap-1 sm:gap-2">
          <SignedIn>
            <a
              href="/dashboard"
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Dashboard
            </a>
            <a
              href="/upload"
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Create Course
            </a>
          </SignedIn>

          <a
            href="/courses"
            className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
          >
            Courses
          </a>

          <SignedIn>
            <div className="ml-2">
              <UserButton afterSignOutUrl="/courses" />
            </div>
          </SignedIn>

          <SignedOut>
            <a
              href="/sign-in"
              className="ml-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Sign in
            </a>
          </SignedOut>
        </nav>
      </div>
    </header>
  );
}
