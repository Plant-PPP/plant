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
  // Every route. Pages also get their CSP, with a per-request nonce, from
  // proxy.ts; X-Frame-Options covers the routes it skips.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
  // AGENTS.md lives at the repo root and is maintained by hand.
  agentRules: false,
};

export default nextConfig;
