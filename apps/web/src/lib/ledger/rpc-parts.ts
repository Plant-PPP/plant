import type { Movement } from "@plant/core";

import type { Ledger } from "./ledger";

// One part of write_operation: the account, portfolio and instrument of its
// holding, and its movement's fields as the movements table stores them.
export type RpcPart = {
  source_connection_id: string;
  portfolio_id: string;
  instrument_symbol: string;
  kind: Movement["kind"];
  date: string;
  currency: Movement["currency"];
  direction: "in" | "out" | null;
  quantity: string | null;
  price: string | null;
  amount: string | null;
  charges: Movement["charges"];
  reference: string | null;
  note: string | null;
  rates: Movement["rates"];
};

// The parts of an operation in a ledger the write produced, each from its
// holding; an empty list once the operation is gone.
export function rpcPartsOf(state: Ledger, operationId: string): RpcPart[] {
  const parts: RpcPart[] = [];
  for (const [holdingId, movements] of state.movements) {
    for (const movement of movements) {
      if (movement.operation_id !== operationId) continue;
      const stored = state.holdings.find(
        (each) => each.holding.id === holdingId,
      );
      if (!stored || stored.holding.asset_class !== "instrument") {
        throw new Error("an operation's part has no instrument holding");
      }
      parts.push({
        source_connection_id: stored.accountId,
        portfolio_id: stored.portfolioId,
        instrument_symbol: stored.holding.instrument_symbol,
        kind: movement.kind,
        date: movement.date,
        currency: movement.currency,
        direction: "direction" in movement ? movement.direction : null,
        quantity: "quantity" in movement ? movement.quantity : null,
        price: "price" in movement ? movement.price : null,
        amount: "amount" in movement ? movement.amount : null,
        charges: movement.charges,
        reference: movement.reference,
        note: movement.note,
        rates: movement.rates,
      });
    }
  }
  return parts;
}

// The instruments an operation touches in a ledger.
export function operationSymbols(
  state: Ledger,
  operationId: string,
): Set<string> {
  return new Set(
    rpcPartsOf(state, operationId).map((part) => part.instrument_symbol),
  );
}

// The revision write_operation expects of every holding of the instruments,
// archived ones included.
export function expectedRevisions(
  revisions: ReadonlyMap<string, number>,
  symbolOf: ReadonlyMap<string, string>,
  symbols: ReadonlySet<string>,
): Record<string, number> {
  return Object.fromEntries(
    [...symbolOf]
      .filter(([, symbol]) => symbols.has(symbol))
      .map(([id]) => [id, revisions.get(id) ?? 0]),
  );
}
