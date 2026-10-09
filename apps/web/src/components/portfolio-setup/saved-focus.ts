import { useRef } from "react";

// Where a form dialog sends focus on close: back to its opener, or to
// `fallback` when the opener is gone, or when a save removes it
// (`savedRemovesOpener`) and the save's refresh may land after the close.
export function useSavedFocus(
  fallback: () => HTMLElement | null,
  savedRemovesOpener: boolean,
) {
  const saved = useRef(false);
  return {
    markSaved: () => {
      saved.current = true;
    },
    returnFocusTo: (opener: HTMLElement | null) =>
      (saved.current && savedRemovesOpener) || !opener ? fallback() : opener,
  };
}
