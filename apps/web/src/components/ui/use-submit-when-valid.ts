"use client";

import { useEffect } from "react";

// The forms under `root` (or `root` itself, a form) skip the browser's own validation bubbles and keep
// their submit buttons disabled until every required field is filled, so a
// form can only be sent once it is complete; a select showing its
// placeholder counts as unfilled. A field that appears later (a
// branch of the form) counts as soon as it is there.
// Takes the element itself (from a callback ref into state), not a ref: a
// dialog's content mounts a render after the dialog, when a ref's effect has
// already run.
export function useSubmitWhenValid(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    const sync = () => {
      const forms =
        element instanceof HTMLFormElement
          ? [element]
          : element.querySelectorAll("form");
      for (const form of forms) {
        form.noValidate = true;
        // A select still showing its placeholder has nothing chosen yet.
        const valid =
          form.checkValidity() &&
          !form.querySelector(
            '[data-slot="select-trigger"][data-placeholder]:not(:disabled)',
          );
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
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-placeholder"],
    });
    return () => {
      element.removeEventListener("input", sync);
      element.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, [element]);
}
