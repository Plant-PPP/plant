"use client";

import "./globals.css";

import { ErrorRetry } from "@/components/error-retry";
import { useReportError } from "@/components/use-report-error";

// Catches an error in the root layout itself, which it replaces.
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useReportError(error);
  return (
    <html lang="es-AR">
      <body className="antialiased">
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
          <ErrorRetry retry={retry} />
        </main>
      </body>
    </html>
  );
}
