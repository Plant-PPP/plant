"use client";

import { ErrorRetry } from "@/components/error-retry";

export default function AppError({ retry }: { retry: () => void }) {
  return <ErrorRetry retry={retry} />;
}
