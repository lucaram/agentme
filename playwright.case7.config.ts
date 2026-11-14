import { defineConfig, devices } from "@playwright/test";

/** Isolated regression: uses throwaway accounts and never runs the demo seed. */
export default defineConfig({
  testDir: "./e2e", testMatch: ["recall-handoffs.spec.ts", "business-workspace.spec.ts", "sections.spec.ts"], workers: 1,
  timeout: 120_000, expect: { timeout: 30_000 }, reporter: "list",
  use: { baseURL: "http://localhost:3001", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --port 3001", url: "http://localhost:3001/login",
    reuseExistingServer: false, timeout: 120_000,
    env: { APP_URL: "http://localhost:3001", LLM_PROVIDER: "mock", ALLOW_LOCAL_FETCH: "1", AGENTME_DISABLE_SWEEPER: "1", AGENTME_TEST_DIST_DIR: ".next-case7" },
  },
});
