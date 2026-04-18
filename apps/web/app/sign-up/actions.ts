"use server";

import { createHash, timingSafeEqual } from "node:crypto";

const ACCESS_CODE_HASH = process.env["ACCESS_CODE_HASH"] ?? "";

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

  return { valid: true };
}
