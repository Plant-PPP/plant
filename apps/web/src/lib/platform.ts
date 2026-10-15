import { useSyncExternalStore } from "react";

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const never = () => () => {};

// Whether shortcuts use ⌘ rather than Ctrl; the server renders Ctrl.
export function useMac(): boolean {
  return useSyncExternalStore(never, isMac, () => false);
}

// ⌘K on a Mac, Ctrl+K elsewhere, outside an IME composition.
export const isAssistantShortcut = (event: KeyboardEvent) =>
  !event.defaultPrevented &&
  !event.isComposing &&
  event.key === "k" &&
  (isMac() ? event.metaKey : event.ctrlKey);
