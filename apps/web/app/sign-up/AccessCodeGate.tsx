"use client";

import { useFormState, useFormStatus } from "react-dom";

import { validateAccessCode } from "./actions";

type GateState = { valid: boolean; error?: string };

const INITIAL_STATE: GateState = { valid: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
    >
      {pending ? "Verifying…" : "Continue"}
    </button>
  );
}

export function AccessCodeGate() {
  const [state, formAction] = useFormState(validateAccessCode, INITIAL_STATE);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold text-gray-900">Sign Up</h1>
        <p className="mb-6 text-sm text-gray-600">Enter your access code to create an account.</p>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="accessCode" className="mb-1 block text-sm font-medium text-gray-700">
              Access Code
            </label>
            <input
              id="accessCode"
              name="accessCode"
              type="password"
              required
              autoComplete="off"
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Enter your access code"
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </div>
    </div>
  );
}
