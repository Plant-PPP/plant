import { Inngest } from "inngest";

// Dev mode turns off request signature checks, so it comes from NODE_ENV
// (fixed by the build) and never from INNGEST_DEV, which a stray env var on
// Vercel could set.
export const inngest = new Inngest({
  id: "plant",
  isDev: process.env.NODE_ENV === "development",
});
