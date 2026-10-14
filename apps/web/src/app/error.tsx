"use client";

import { ErrorRetry } from "@/components/error-retry";
import { useReportError } from "@/components/use-report-error";

// Catches what (app)/error.tsx cannot: errors in (app)/layout.tsx, such as
// Auth being unavailable.
export default function RootError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useReportError(error);
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <ErrorRetry retry={retry} />
    </main>
  );
}
