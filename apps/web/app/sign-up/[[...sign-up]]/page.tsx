import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";

import { AccessCodeGate } from "../AccessCodeGate";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function SignUpPage() {
  return (
    <AccessCodeGate>
      <div className="flex min-h-[60vh] items-center justify-center">
        <SignUp />
      </div>
    </AccessCodeGate>
  );
}
