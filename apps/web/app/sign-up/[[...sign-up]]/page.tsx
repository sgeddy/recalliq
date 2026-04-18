import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AccessCodeGate } from "../AccessCodeGate";
import { hasValidAccessCookie } from "../actions";

export const metadata: Metadata = {
  title: "Sign up",
};

export default async function SignUpPage() {
  const hasAccess = await hasValidAccessCookie();

  if (!hasAccess) {
    return <AccessCodeGate />;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <SignUp />
    </div>
  );
}
