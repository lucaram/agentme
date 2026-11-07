import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Base URL other agents use to reach this AGENTME instance's A2A endpoints. */
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3000";
  },
  get a2aSigningSecret() {
    const secret = required("A2A_SIGNING_SECRET");
    if (secret.length < 32) throw new Error("A2A_SIGNING_SECRET must be at least 32 characters");
    return secret;
  },
  get llmProvider(): "anthropic" | "mock" {
    return process.env.LLM_PROVIDER === "mock" ? "mock" : "anthropic";
  },
};
