import { defineConfig } from "vitest/config";


export default defineConfig({
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // Next's compile-time guard has no meaning in unit tests.
      "server-only": `${import.meta.dirname}/tests/stubs/empty.ts`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { LLM_PROVIDER: "mock" },
  },
});
