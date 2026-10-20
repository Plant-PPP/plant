"use client";

import { useEffect } from "react";

// Starts `load` once the browser is idle after the page shows, so code split
// off the page (a dialog) is there by the time the user opens it.
export function usePreload(load: () => Promise<unknown>) {
  useEffect(() => {
    const start = () => void load().catch(() => {});
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(start, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(start, 200);
    return () => clearTimeout(timer);
  }, [load]);
}
