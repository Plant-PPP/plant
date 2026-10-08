"use client";

import { ErrorRetry } from "@/components/error-retry";

// Catches what (app)/error.tsx cannot: errors in (app)/layout.tsx, such as
// Auth being unavailable.
export default function RootError({ retry }: { retry: () => void }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <ErrorRetry retry={retry} />
    </main>
  );
}
