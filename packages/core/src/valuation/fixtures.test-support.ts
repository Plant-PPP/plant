import type { QuoteSnapshot } from "../quotes/contract/quote";

// A Monday in Buenos Aires: the dollar rates are Friday's, BTC is today's.
// MEP 1200, CCL 1250, official 1000, BTC 65000 USD.
export const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-12",
  fx: {
    mep: { sell: "1200", date: "2026-10-09" },
    ccl: { sell: "1250", date: "2026-10-09" },
    official: { sell: "1000", date: "2026-10-09" },
  },
  prices: {
    BTC: { price: "65000", currency: "USD", date: "2026-10-12" },
    ETH: { price: "2500", currency: "USD", date: "2026-10-12" },
  },
};
