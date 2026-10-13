"use client";

import { notFound } from "next/navigation";

import { ImportPage } from "@/components/imports/import-page";
import { ImportReview } from "@/components/imports/import-review";
import { usedThisMonth } from "@/lib/format/text";

import { usePrototype } from "./prototype-provider";
import { heldElsewhere, heldOn } from "./prototype-imports-store";

const reviewHref = (id: string) => `/import/${id}`;

// Cargar over the prototype's store.
export function PrototypeImports() {
  const { state, actions } = usePrototype();
  return (
    <ImportPage
      accounts={state.accounts}
      archivedAccounts={state.archivedAccounts}
      imports={state.imports}
      used={usedThisMonth(state.uploadedOn, state.today)}
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
  return (
    <ImportReview
      item={item}
      institution={account?.institution ?? ""}
      instruments={state.instruments}
      held={heldOn(state, item.accountId, item.documentDate ?? state.today)}
      routing={
        account && {
          portfolios: state.portfolios,
          defaultPortfolioId: account.portfolio.id,
          elsewhere: heldElsewhere(state, item.accountId),
        }
      }
      backHref="/import"
      doneHref="/import"
      actions={actions.imports}
    />
  );
}
