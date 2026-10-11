import { compareDecimals } from "@plant/shared";

import type { HoldingRow } from "@/lib/holdings/read";

export type BreakdownLine<Entity> = Entity & { count: number };

// One line per account or portfolio the shown holdings sit in, with how many
// they are, largest value first; one the page has not valued yet sorts as zero.
export function breakdownLines<Entity extends { id: string }>(
  rows: readonly HoldingRow[],
  entityOf: (row: HoldingRow) => Entity,
  valueOf: (id: string) => string | undefined,
): BreakdownLine<Entity>[] {
  const lines = new Map<string, BreakdownLine<Entity>>();
  for (const row of rows) {
    const entity = entityOf(row);
    const line = lines.get(entity.id) ?? { ...entity, count: 0 };
    line.count += 1;
    lines.set(entity.id, line);
  }
  const sortValue = (line: BreakdownLine<Entity>) => valueOf(line.id) ?? "0";
  return [...lines.values()].sort((a, b) =>
    compareDecimals(sortValue(b), sortValue(a)),
  );
}
