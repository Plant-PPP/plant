import type { ChartPart } from "@/lib/assistant/chat";
import {
  type Liability,
  placementFigures,
  compareMovements,
  type Denominator,
  type Movement,
  referenceUnit,
} from "@plant/core";

import { type AssetKey, assetKey } from "@/lib/holdings/assets-rows";
import { CONSENT_VERSION } from "@/lib/consent";
import {
  PLACEMENT_KINDS,
  type PlacementKind,
  renewalInputSchema,
} from "@/lib/holdings/placement";
import {
  type RealEstateSheet,
  realEstateSheetSchema,
} from "@/lib/real-estate/sheet";
import type { Conversation } from "@/lib/assistant/chat";
import type { PriceAlert } from "@/lib/alerts/alerts";
import type { ImportItem } from "@/lib/imports/review";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { HoldingDeleteResult } from "@/lib/holdings/delete-result";
import type { Fixtures } from "@/lib/prototype/fixtures";

import {
  createHolding,
  deleteOperation as ledgerDeleteOperation,
  type Ledger,
  MANUAL,
  refused,
  refusedWrite,
  updateHolding,
  removeHolding as ledgerRemoveHolding,
  type Write as LedgerWrite,
  writeOperation as ledgerWriteOperation,
} from "@/lib/ledger/ledger";

export * from "@/lib/ledger/ledger";

// The prototype's data, held in memory: the fixtures as the user changes them,
// the ledger the real pages read from the database and what the prototype
// alone keeps.
export type PrototypeState = Ledger & {
  // The unit the data pages open in; null for the reference dollar's.
  preferredUnit: Denominator | null;
  // The version of the terms the user accepted, and when; null before the
  // first file.
  consent: { version: string; acceptedOn: string } | null;
  // The assets the user left out of the report, by `assetKey`.
  outOfTaxReport: ReadonlySet<AssetKey>;
  // What each placement at a rate is, by holding id; a plazo fijo has none.
  placements: ReadonlyMap<string, PlacementKind>;
  // The placement each renewal renewed, by the renewal's holding id.
  renewals: ReadonlyMap<string, string>;
  // Each property's sheet, by holding id.
  realEstate: ReadonlyMap<string, RealEstateSheet>;
  // The closed months a write changed, by period, with the day it did.
  recalculated: ReadonlyMap<string, string>;
  // Newest first.
  liabilities: Liability[];
  // Newest first.
  imports: ImportItem[];
  // The day of each upload, deleted accounts' included: the monthly limit
  // counts them all.
  uploadedOn: string[];
  // Newest first.
  conversations: Conversation[];
  // The day of each question asked, deleted conversations' included.
  askedOn: string[];
  // The assistant's charts pinned to Resumen, as drawn: the prototype's data
  // does not change under them. Oldest first.
  pinnedCharts: { id: string; chart: ChartPart }[];
  // The price alerts, newest first. One is checked against the prototype's
  // quotes when it is set, since no job runs here.
  priceAlerts: PriceAlert[];
};

export type Write<R> = LedgerWrite<R, PrototypeState>;

// What the prototype keeps of a holding goes with it: its placement, its
// property sheet, and its asset's report choice with the asset's last
// holding.
function forgetGone(state: PrototypeState): PrototypeState {
  const ids = new Set(state.holdings.map((each) => each.holding.id));
  const keys = new Set(state.holdings.map((each) => assetKey(each.holding)));
  const outOfTaxReport = [...state.outOfTaxReport].every((key) => keys.has(key))
    ? state.outOfTaxReport
    : new Set([...state.outOfTaxReport].filter((key) => keys.has(key)));
  const placements = [...state.placements.keys()].every((id) => ids.has(id))
    ? state.placements
    : new Map([...state.placements].filter(([id]) => ids.has(id)));
  const realEstate = [...state.realEstate.keys()].every((id) => ids.has(id))
    ? state.realEstate
    : new Map([...state.realEstate].filter(([id]) => ids.has(id)));
  return outOfTaxReport === state.outOfTaxReport &&
    placements === state.placements &&
    realEstate === state.realEstate
    ? state
    : { ...state, outOfTaxReport, placements, realEstate };
}

const forgetting =
  <A extends unknown[], R>(
    write: (state: PrototypeState, ...args: A) => Write<R>,
  ) =>
  (state: PrototypeState, ...args: A): Write<R> => {
    const written = write(state, ...args);
    return { ...written, state: forgetGone(written.state) };
  };

// The ledger's writes that can remove a holding.
export const writeOperation = forgetting(ledgerWriteOperation);
export const deleteOperation = forgetting(ledgerDeleteOperation);
const removeHolding = (state: PrototypeState, id: string): PrototypeState =>
  forgetGone(ledgerRemoveHolding(state, id));

// The unit a data page shows with no ?unit=: the user's choice, else their
// reference dollar's.
// The terms accepted, in the version in force, before the first file.
export function acceptConsent(
  state: PrototypeState,
  version: string,
): Write<{ ok: true; id: string }> {
  return {
    state: { ...state, consent: { version, acceptedOn: state.today } },
    result: { ok: true, id: version },
  };
}

export const homeUnit = (state: PrototypeState): Denominator =>
  state.preferredUnit ?? referenceUnit(state.referenceDollar);

// The user's view preferences: the reference dollar and the unit the pages
// open in.
export function setPreferences(
  state: PrototypeState,
  preferences: Pick<PrototypeState, "referenceDollar" | "preferredUnit">,
): Write<{ ok: true; id: string }> {
  return {
    state: { ...state, ...preferences },
    result: { ok: true, id: "preferences" },
  };
}

export function initialState(
  fixtures: Fixtures,
  today: string,
): PrototypeState {
  const movements = new Map<string, Movement[]>();
  for (const movement of fixtures.movements) {
    const own = movements.get(movement.holding_id) ?? [];
    own.push(movement);
    movements.set(movement.holding_id, own);
  }
  for (const own of movements.values()) own.sort(compareMovements);
  return {
    today,
    referenceDollar: fixtures.referenceDollar,
    preferredUnit: null,
    // The made-up user loaded their files already, so accepted the terms.
    consent:
      fixtures.accounts.length > 0
        ? { version: CONSENT_VERSION, acceptedOn: today }
        : null,
    instruments: fixtures.instruments,
    accounts: fixtures.accounts,
    portfolios: fixtures.portfolios,
    archivedAccounts: [],
    archivedPortfolios: [],
    holdings: fixtures.holdings.map((row) => ({
      holding: row.holding,
      accountId: row.account.id,
      portfolioId: row.portfolio.id,
      closed: fixtures.closed.includes(row.id),
      origin: MANUAL,
    })),
    movements,
    nextEntryOrder:
      Math.max(-1, ...fixtures.movements.map((each) => each.entry_order)) + 1,
    revisions: new Map([...movements.keys()].map((id) => [id, 0])),
    quotes: fixtures.quotes,
    manualPrices: fixtures.manualPrices,
    manualRates: [],
    outOfTaxReport: new Set(),
    operationOrigins: new Map(),
    placements: new Map(Object.entries(fixtures.placements ?? {})),
    renewals: new Map(),
    realEstate: new Map(Object.entries(fixtures.realEstate ?? {})),
    recalculated: new Map(),
    liabilities: fixtures.liabilities,
    imports: [],
    uploadedOn: [],
    conversations: [],
    askedOn: [],
    pinnedCharts: [],
    priceAlerts: [],
  };
}

// What a user starts with after deleting the account and signing up again:
// one "Principal" portfolio, as the database gives a new user, and nothing
// else; the market data stays.
export function freshState(
  state: PrototypeState,
  portfolioId: string,
): PrototypeState {
  return initialState(
    {
      referenceDollar: "mep",
      accounts: [],
      portfolios: [{ id: portfolioId, name: "Principal" }],
      instruments: state.instruments,
      holdings: [],
      closed: [],
      movements: [],
      quotes: state.quotes,
      manualPrices: [],
      liabilities: [],
    },
    state.today,
  );
}

// A holding and every movement it has. An operation it shared keeps its other
// portfolios' parts. A holding with a transfer is refused: the transfer's
// other side would be left alone.
export function deleteHolding(
  state: PrototypeState,
  id: string,
): Write<HoldingDeleteResult> {
  if (!state.holdings.some((each) => each.holding.id === id)) {
    return refused(state, { ok: false, code: "not_found" });
  }
  if ((state.movements.get(id) ?? []).some(({ kind }) => kind === "transfer")) {
    return refused(state, { ok: false, code: "holding_has_transfers" });
  }
  return { state: removeHolding(state, id), result: { ok: true, id } };
}

// A property's sheet, whose debt, if any, is one of the user's.
export function setRealEstateSheet(
  state: PrototypeState,
  id: string,
  input: unknown,
): Write<WriteResult> {
  const parsed = realEstateSheetSchema.safeParse(input);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  const stored = state.holdings.find((each) => each.holding.id === id);
  const { liabilityId } = parsed.data;
  if (
    stored?.holding.asset_class !== "real_estate" ||
    (liabilityId !== null &&
      !state.liabilities.some((each) => each.id === liabilityId))
  ) {
    return refused(state, { ok: false, code: "not_found" });
  }
  return {
    state: {
      ...state,
      realEstate: new Map(state.realEstate).set(id, parsed.data),
    },
    result: { ok: true, id },
  };
}

// Whether an asset counts in the report. Any of its holdings, open or closed,
// makes it one the user has.
export function setInTaxReport(
  state: PrototypeState,
  key: AssetKey,
  on: boolean,
): Write<WriteResult> {
  if (!state.holdings.some((each) => assetKey(each.holding) === key)) {
    return refusedWrite(state, "not_found");
  }
  if (state.outOfTaxReport.has(key) !== on) {
    return { state, result: { ok: true, id: key } };
  }
  const outOfTaxReport = new Set(state.outOfTaxReport);
  if (on) outOfTaxReport.delete(key);
  else outOfTaxReport.add(key);
  return { state: { ...state, outOfTaxReport }, result: { ok: true, id: key } };
}

// A holding's edit and its asset's report choice, both or neither.
export function updateHoldingDetails(
  state: PrototypeState,
  id: string,
  input: unknown,
  {
    inTaxReport,
    placement,
  }: { inTaxReport: boolean; placement?: PlacementKind },
): Write<WriteResult> {
  const updated = updateHolding(state, id, input);
  if (!updated.result.ok) return updated;
  const stored = updated.state.holdings.find((each) => each.holding.id === id)!;
  const flagged = setInTaxReport(
    updated.state,
    assetKey(stored.holding),
    inTaxReport,
  );
  if (!flagged.result.ok) return refused(state, flagged.result);
  const placed =
    placement === undefined
      ? flagged
      : setPlacement(flagged.state, id, placement);
  return placed.result.ok
    ? { state: placed.state, result: updated.result }
    : refused(state, placed.result);
}

// What a placement at a rate is: a plazo fijo unless the user says otherwise.
export function setPlacement(
  state: PrototypeState,
  id: string,
  kind: PlacementKind,
): Write<WriteResult> {
  const stored = state.holdings.find((each) => each.holding.id === id);
  if (
    stored?.holding.asset_class !== "fixed_term" ||
    !PLACEMENT_KINDS.includes(kind)
  ) {
    return refused(state, { ok: false, code: "not_found" });
  }
  const placements = new Map(state.placements);
  if (kind === "fixed_term") placements.delete(id);
  else placements.set(id, kind);
  return { state: { ...state, placements }, result: { ok: true, id } };
}

// A placement that matured, placed again: a new holding in its account and
// portfolio with its capital plus the interest, its kind and its name, on a
// new term and rate. The matured one closes, out of the lists, so the money
// counts once; the renewal remembers it.
export function renewPlacement(
  state: PrototypeState,
  id: string,
  input: unknown,
  newId: string,
): Write<WriteResult> {
  const parsed = renewalInputSchema.safeParse(input);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  const stored = state.holdings.find((each) => each.holding.id === id);
  const old = stored?.holding;
  if (!stored || stored.closed || old?.asset_class !== "fixed_term") {
    return refused(state, { ok: false, code: "not_found" });
  }
  const term = parsed.data;
  if (state.today < old.matures_on || term.started_on < old.matures_on) {
    return refused(state, { ok: false, code: "invalid" });
  }
  const created = createHolding(
    state,
    {
      source_connection_id: stored.accountId,
      portfolio_id: stored.portfolioId,
      asset_class: "fixed_term",
      instrument_symbol: null,
      valued_on: null,
      currency: old.currency,
      amount: placementFigures(old, state.today).maturityAmount,
      annual_rate: term.annual_rate,
      started_on: term.started_on,
      matures_on: term.matures_on,
      label: old.label,
    },
    newId,
  );
  if (!created.result.ok) return created;
  const kind = state.placements.get(id);
  return {
    state: {
      ...created.state,
      holdings: created.state.holdings.map((each) =>
        each.holding.id === id ? { ...each, closed: true } : each,
      ),
      placements:
        kind === undefined
          ? created.state.placements
          : new Map(created.state.placements).set(newId, kind),
      renewals: new Map(created.state.renewals).set(newId, id),
    },
    result: { ok: true, id: newId },
  };
}
