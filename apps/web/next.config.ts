import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript sources; Next compiles them.
  transpilePackages: [
    "@plant/core",
    "@plant/jobs",
    "@plant/shared",
    "@plant/sources",
  ],
  poweredByHeader: false,
  // Baseline for every route. A nonce-based CSP comes with PLA-19.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  // AGENTS.md lives at the repo root and is maintained by hand.
  agentRules: false,
};

export default nextConfig;
