import type { Ledger } from "./ledger";

export const ACCOUNT = "a5000000-0000-4000-8000-0000000000a5";
export const PORTFOLIO = "a1000000-0000-4000-8000-0000000000a1";
export const OTHER_PORTFOLIO = "a2000000-0000-4000-8000-0000000000a2";

// A user with one account, two portfolios and nothing held, at stored MEP and
// CCL rates on the day before the purchases below.
export function emptyLedger(): Ledger {
  return {
    today: "2026-10-12",
    referenceDollar: "mep",
    instruments: [
      { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
    ],
    accounts: [
      {
        id: ACCOUNT,
        institution: "IOL",
        includeInTaxReport: true,
        portfolio: { id: PORTFOLIO, name: "Principal", archived: false },
      },
    ],
    portfolios: [
      { id: PORTFOLIO, name: "Principal" },
      { id: OTHER_PORTFOLIO, name: "Largo plazo" },
    ],
    archivedAccounts: [],
    archivedPortfolios: [],
    holdings: [],
    movements: new Map(),
    nextEntryOrder: 1,
    revisions: new Map(),
    quotes: {
      fxRates: [
        { kind: "mep", rate_date: "2026-09-14", sell: "1200" },
        { kind: "ccl", rate_date: "2026-09-14", sell: "1250" },
        { kind: "official", rate_date: "2026-09-14", sell: "1000" },
      ],
      prices: [],
    },
    manualPrices: [],
    manualRates: [],
    operationOrigins: new Map(),
  };
}

// A purchase of AAPL split across both portfolios.
export const PURCHASE = {
  kind: "purchase",
  source_connection_id: ACCOUNT,
  instrument_symbol: "AAPL",
  date: "2026-09-15",
  currency: "ARS",
  price: "18000",
  charges: [],
  reference: null,
  note: null,
  parts: [
    { portfolio_id: PORTFOLIO, quantity: "3" },
    { portfolio_id: OTHER_PORTFOLIO, quantity: "2" },
  ],
};
