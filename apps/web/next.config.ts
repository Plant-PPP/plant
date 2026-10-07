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
  // AGENTS.md lives at the repo root and is maintained by hand.
  agentRules: false,
};

export default nextConfig;
