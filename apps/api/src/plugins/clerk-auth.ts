import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId: string | null;
  }
}

// Derive JWKS URL from publishable key:
// pk_test_BASE64$ → decode base64 → "your-instance.clerk.accounts.dev$" → strip $
function getJwksUrl(): string {
  const pubKey =
    process.env["CLERK_PUBLISHABLE_KEY"] ?? process.env["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"] ?? "";
  const encoded = pubKey.split("_")[2] ?? "";
  const decoded = Buffer.from(encoded, "base64").toString("utf-8").replace(/\$$/, "");
  return `https://${decoded}/.well-known/jwks.json`;
}

const JWKS = createRemoteJWKSet(new URL(getJwksUrl()));

export async function extractUserId(request: FastifyRequest): Promise<string | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);

  try {
    const { payload } = await jwtVerify(token, JWKS);
    return payload.sub ?? null;
  } catch (err) {
    console.error("[clerk-auth] jwtVerify failed:", err);
    return null;
  }
}

export function buildRequireAuth() {
  return async function requireAuthHandler(request: FastifyRequest): Promise<void> {
    if (!request.userId) {
      throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
    }
  };
}
