import type { ListChange } from "@/components/portfolio-setup/list-change";
import type { InstrumentHolding } from "@/lib/holdings/instrument-history";
import type { HoldingRow } from "@/lib/holdings/read";

// One instrument's holdings as its page shows them, a holding a write has not
// saved yet marked.
export type ShownInstrumentHolding = InstrumentHolding & { unsaved?: true };

// A write on an instrument's page, shown before the server confirms it:
// a movement rewrites the holding it touches and a delete takes one away.
// Applied again over the refreshed list it changes nothing more. The page
// never archives, restores or creates a holding row; a movement into a new
// account or portfolio sends no change and shows on the refresh.
export function applyInstrumentChange(
  holdings: readonly ShownInstrumentHolding[],
  change: ListChange<HoldingRow> | null,
): readonly ShownInstrumentHolding[] {
  if (change?.kind === "update") {
    return holdings.map((each) =>
      each.row.id === change.row.id
        ? { ...each, row: change.row, unsaved: true }
        : each,
    );
  }
  if (change?.kind === "delete") {
    return holdings.filter((each) => each.row.id !== change.id);
  }
  return holdings;
}
