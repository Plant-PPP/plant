import * as React from "react";

// Tailwind's md breakpoint, in rem so it scales with the browser's font size
// exactly like the md: classes that hide the desktop sidebar.
const MOBILE_QUERY = "(width < 48rem)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
