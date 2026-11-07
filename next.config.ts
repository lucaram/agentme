import type { NextConfig } from "next";

// Cache Components / Partial Prefetching are deliberately off for the MVP:
// almost every AGENTME screen is per-user and realtime, so classic dynamic
// rendering keeps the auth/data code simple. Revisit when adding public pages.
const nextConfig: NextConfig = {
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
