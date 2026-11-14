import type { NextConfig } from "next";

// Cache Components / Partial Prefetching are deliberately off for the MVP:
// almost every AGENTME screen is per-user and realtime, so classic dynamic
// rendering keeps the auth/data code simple. Revisit when adding public pages.
const nextConfig: NextConfig = {
  // Isolated browser regressions can run alongside the developer's server.
  distDir: process.env.AGENTME_TEST_DIST_DIR ?? ".next",
  typescript: { tsconfigPath: process.env.AGENTME_TEST_DIST_DIR ? "tsconfig.case7.json" : "tsconfig.json" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
