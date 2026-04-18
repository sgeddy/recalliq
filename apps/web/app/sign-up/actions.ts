"use server";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ACCESS_CODE_HASH = process.env["ACCESS_CODE_HASH"] ?? "";
const COOKIE_NAME = "recalliq_access";
const COOKIE_MAX_AGE_SECONDS = 60 * 60; // 1 hour

function signCookieValue(): string {
  return createHmac("sha256", ACCESS_CODE_HASH).update("valid").digest("hex");
}

export async function hasValidAccessCookie(): Promise<boolean> {
  if (!ACCESS_CODE_HASH) return false;

  const cookie = cookies().get(COOKIE_NAME);
  if (!cookie) return false;

  const expected = signCookieValue();
  if (cookie.value.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(cookie.value, "hex"), Buffer.from(expected, "hex"));
}

export async function validateAccessCode(
  _prev: { valid: boolean; error?: string },
  formData: FormData,
): Promise<{ valid: boolean; error?: string }> {
  const code = formData.get("accessCode");

  if (!ACCESS_CODE_HASH) {
    return { valid: false, error: "Registration is currently closed." };
  }

  if (typeof code !== "string" || code.length === 0) {
    return { valid: false, error: "Access code is required." };
  }

  if (code.length > 256) {
    return { valid: false, error: "Invalid access code." };
  }

  const inputHash = createHash("sha256").update(code).digest();
  const expectedHash = Buffer.from(ACCESS_CODE_HASH, "hex");

  if (expectedHash.length !== 32) {
    return { valid: false, error: "Registration is currently closed." };
  }

  const isValid = timingSafeEqual(inputHash, expectedHash);

  if (!isValid) {
    return { valid: false, error: "Invalid access code." };
  }

  cookies().set(COOKIE_NAME, signCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/sign-up",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  redirect("/sign-up");
}
