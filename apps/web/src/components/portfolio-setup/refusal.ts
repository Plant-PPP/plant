import type { z } from "zod";

// The first field, in the form's order, that a schema refused: which column
// each issue is about maps to a field, and `empty` says the value was missing
// rather than wrong. Undefined when no issue names a field.
export function firstRefused<F extends string>(
  error: z.ZodError,
  fieldByColumn: Readonly<Record<string, F>>,
  order: readonly F[],
): { field: F; empty: boolean } | undefined {
  return error.issues
    .flatMap((issue) => {
      const column = issue.path[0];
      const field =
        typeof column === "string" && Object.hasOwn(fieldByColumn, column)
          ? fieldByColumn[column]
          : undefined;
      return field ? [{ field, empty: issue.code === "invalid_type" }] : [];
    })
    .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field))[0];
}
