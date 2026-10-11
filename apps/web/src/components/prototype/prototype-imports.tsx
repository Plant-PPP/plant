"use client";

import { exactOf, plus, toDecimal } from "@plant/shared";
import { notFound } from "next/navigation";

import { ImportPage } from "@/components/imports/import-page";
import { ImportReview } from "@/components/imports/import-review";

import { usePrototype } from "./prototype-provider";
import { holdingsView } from "./prototype-store";

const reviewHref = (id: string) => `/import/${id}`;

// Cargar over the prototype's store.
export function PrototypeImports() {
  const { state, actions } = usePrototype();
  return (
    <ImportPage
      accounts={state.accounts}
      imports={state.imports}
      today={state.today}
      reviewHref={reviewHref}
      actions={actions.imports}
    />
  );
}

// An import's review over the prototype's store.
export function PrototypeImportReview({ id }: { id: string }) {
  const { state, actions } = usePrototype();
  const item = state.imports.find((each) => each.id === id);
  if (!item || item.status !== "ready") notFound();
  const account = state.accounts.find((each) => each.id === item.accountId);
  const held = new Map<string, string>();
  for (const row of holdingsView(state).active) {
    if (row.account.id !== item.accountId) continue;
    if (row.holding.asset_class !== "instrument") continue;
    const symbol = row.holding.instrument_symbol;
    held.set(
      symbol,
      toDecimal(
        plus(exactOf(held.get(symbol) ?? "0"), exactOf(row.holding.amount)),
        8,
      ),
    );
  }
  return (
    <ImportReview
      item={item}
      institution={account?.institution ?? ""}
      instruments={state.instruments}
      held={held}
      backHref="/import"
      doneHref="/import"
      actions={actions.imports}
    />
  );
}
