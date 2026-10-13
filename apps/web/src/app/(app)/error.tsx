"use client";

import { ErrorRetry } from "@/components/error-retry";
import { useReportError } from "@/components/use-report-error";

export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useReportError(error);
  return <ErrorRetry retry={retry} />;
}
