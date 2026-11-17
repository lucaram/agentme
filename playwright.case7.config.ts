import { defineConfig, devices } from "@playwright/test";

/** Isolated regression: uses throwaway accounts and never runs the demo seed. */
export default defineConfig({
  testDir: "./e2e", testMatch: ["account-status.spec.ts", "avatars.spec.ts", "business-teams.spec.ts", "staff-controls.spec.ts", "identity-notifications.spec.ts", "business-staff.spec.ts","recall-handoffs.spec.ts", "business-workspace.spec.ts", "sections.spec.ts", "participation-history.spec.ts", "current-actions.spec.ts", "chat-media.spec.ts", "share-messages.spec.ts", "message-receipts.spec.ts", "delete-messages.spec.ts", "chat-history.spec.ts", "message-reactions.spec.ts", "mentions.spec.ts", "agent-topics.spec.ts", "saved-tip-visibility.spec.ts", "onboarding.spec.ts", "presence.spec.ts", "group-consent.spec.ts", "platform-moderation.spec.ts"], workers: 1,
  timeout: 120_000, expect: { timeout: 30_000 }, reporter: "list",
  use: { baseURL: "http://localhost:3001", trace: "retain-on-failure", launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --port 3001", url: "http://localhost:3001/login",
    reuseExistingServer: false, timeout: 120_000,
    env: { APP_URL: "http://localhost:3001", LLM_PROVIDER: "mock", ALLOW_LOCAL_FETCH: "1", AGENTME_DISABLE_SWEEPER: "1", AGENTME_TEST_DIST_DIR: ".next-case7" },
  },
});
