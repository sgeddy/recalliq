import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "./globals.css";
import { NavBar } from "./components/NavBar";

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
          <NavBar />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
