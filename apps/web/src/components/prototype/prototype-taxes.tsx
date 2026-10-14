"use client";

import { exactOf, minus, stored } from "@plant/shared";

import { TaxesPage } from "@/components/taxes/taxes-page";
import { heldOn } from "@/lib/summary/compute";
import type { KeysetParams } from "@/lib/supabase/keyset";
import {
  defaultTaxYear,
  leftOutOf,
  type OfficialBuy,
  taxDate,
  taxReport,
  taxYearOf,
  taxYears,
} from "@/lib/taxes/report";

import { usePrototype } from "./prototype-provider";

// The made-up quotes keep no buying rate: the prototype takes the official
// selling rate less a typical spread.
const PROTOTYPE_SPREAD = "40";

// Impuestos over the prototype's store.
export function PrototypeTaxes({ params }: { params: KeysetParams }) {
  const { state } = usePrototype();
  const years = taxYears(state);
  const year = taxYearOf(params.year, years, state.today);
  const official = heldOn(state, taxDate(year, state.today)).snapshot.fx
    .official;
  const officialBuy: OfficialBuy | null = official
    ? {
        buy: stored(minus(exactOf(official.sell), exactOf(PROTOTYPE_SPREAD))),
        date: official.date,
      }
    : null;
  return (
    <TaxesPage
      report={taxReport(state, {
        year,
        officialBuy,
        leftOut: leftOutOf(state, state.outOfTaxReport),
        // A placement the user named is not a plazo fijo.
        isPlazoFijo: (row) =>
          (state.placements.get(row.id) ?? "fixed_term") === "fixed_term",
      })}
      years={years}
      defaultYear={defaultTaxYear(years, state.today)}
      placementKinds
      assetExclusion
    />
  );
}
