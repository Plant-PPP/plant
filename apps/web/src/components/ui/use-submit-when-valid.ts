"use client";

import { type RefObject, useEffect } from "react";

// The forms under `root` (or `root` itself, a form) skip the browser's own validation bubbles and keep
// their submit buttons disabled until every required field is filled, so a
// form can only be sent once it is complete. A field that appears later (a
// branch of the form) counts as soon as it is there.
export function useSubmitWhenValid(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const sync = () => {
      const forms =
        element instanceof HTMLFormElement
          ? [element]
          : element.querySelectorAll("form");
      for (const form of forms) {
        form.noValidate = true;
        const valid = form.checkValidity();
        for (const button of form.querySelectorAll<HTMLButtonElement>(
          'button[type="submit"]',
        )) {
          button.disabled = !valid;
        }
      }
    };
    sync();
    element.addEventListener("input", sync);
    element.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true, subtree: true });
    return () => {
      element.removeEventListener("input", sync);
      element.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, [root]);
}
