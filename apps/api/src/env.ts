const REQUIRED_VARS = ["DATABASE_URL", "CLERK_SECRET_KEY", "ANTHROPIC_API_KEY"] as const;

export function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
