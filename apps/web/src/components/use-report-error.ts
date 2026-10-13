"use client";

import { useEffect } from "react";

import { errorDigest, errorType } from "@/lib/log/error-type";
import { reportClientError } from "@/lib/reports/client";

// What an error page reports: an error thrown in the browser. One with a
// digest came from the server, which logged it already (onRequestError).
export function useReportError(error: unknown) {
  useEffect(() => {
    if (errorDigest(error) !== undefined) return;
    reportClientError({ kind: "error", type: errorType(error) ?? "unknown" });
  }, [error]);
}
