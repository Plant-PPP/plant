"use client";

import { useState } from "react";

// Radix's hidden native select reports "" when the value is set before its
// option renders, as for a row just created here; no option is "".
export function choose(set: (value: string) => void) {
  return (value: string) => {
    if (value !== "") set(value);
  };
}

export type FieldAlert<F> = { text: string; field: F | null };

// A dialog's alert and the field it is about: none for an alert about the
// write itself, such as a failed save. A dialog reopened by a refused write
// starts with the alert, focused on its field.
export function useFieldAlert<F extends string>(
  initialError: string | undefined,
  fieldOf: (text: string) => F | null,
  firstByDefault: F,
) {
  const [alert, setAlert] = useState<FieldAlert<F> | undefined>(() =>
    initialError
      ? { text: initialError, field: fieldOf(initialError) }
      : undefined,
  );
  const [firstField] = useState<F>(() => alert?.field ?? firstByDefault);
  const invalid = (field: F) => (alert?.field === field ? true : undefined);
  // An edit to the field the alert is about clears it.
  function settle(field: F) {
    if (alert?.field === field) setAlert(undefined);
  }
  const pick = (field: F, set: (value: string) => void) =>
    choose((value) => {
      set(value);
      settle(field);
    });
  return { alert, setAlert, firstField, invalid, settle, pick };
}
