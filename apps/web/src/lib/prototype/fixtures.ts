import {
  admitMovement,
  isTrade,
  type Movement,
  type MovementDraft,
  type ReferenceDollar,
  type StoredQuotes,
  snapshotOn,
  UNIT_FX_KINDS,
} from "@plant/core";
import { addDays } from "@plant/shared";

import { rowOf } from "@/components/holdings/holding-fields";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";

// The prototype's made-up data: accounts, portfolios and holdings of every
// class, two years of dollar rates, today's prices, and the movements of the
// instrument holdings. Built from `today`, so the same day gives the same data.
export type Fixtures = {
  referenceDollar: ReferenceDollar;
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  // Every holding, with its amount; an instrument holding's is the quantity
  // its movements leave, and one sold to zero is closed.
  holdings: HoldingRow[];
  closed: string[];
  movements: Movement[];
  quotes: StoredQuotes;
};

const HISTORY_DAYS = 730;

const PORTFOLIOS = {
  principal: { id: "b1000000-0000-4000-8000-000000000001", name: "Principal" },
  largo: { id: "b1000000-0000-4000-8000-000000000002", name: "Largo plazo" },
  corto: { id: "b1000000-0000-4000-8000-000000000003", name: "Corto plazo" },
} as const;

const account = (
  n: number,
  institution: string,
  portfolio: PortfolioRow,
): SourceConnectionRow => ({
  id: `a1000000-0000-4000-8000-00000000000${n}`,
  institution,
  includeInTaxReport: true,
  holder: null,
  portfolio: { ...portfolio, archived: false },
});

const ACCOUNTS = {
  iol: account(1, "IOL", PORTFOLIOS.principal),
  balanz: account(2, "Balanz", PORTFOLIOS.largo),
  binance: account(3, "Binance", PORTFOLIOS.largo),
  cocos: account(4, "Cocos", PORTFOLIOS.corto),
} as const;

const INSTRUMENTS: InstrumentRow[] = [
  { symbol: "BTC", name: "Bitcoin", currency: "USD" },
  { symbol: "ETH", name: "Ethereum", currency: "USD" },
  { symbol: "AAPL", name: "Apple (CEDEAR)", currency: "ARS" },
  { symbol: "KO", name: "Coca-Cola (CEDEAR)", currency: "ARS" },
  { symbol: "AL30", name: "Bonar 2030", currency: "ARS" },
  { symbol: "AL30D", name: "Bonar 2030 (dólares)", currency: "USD" },
  { symbol: "FIMAPREA", name: "FIMA Premium Clase A", currency: "ARS" },
];

// Each feed price: today's and the days before it, a little lower each day
// back. KO and FIMAPREA have none.
const PRICES: [symbol: string, cents: number, currency: "ARS" | "USD"][] = [
  ["BTC", 6_512_345, "USD"],
  ["ETH", 251_020, "USD"],
  ["AAPL", 1_865_000, "ARS"],
  // A bond's price is per unit: AL30 quotes ARS 85.300 per 100 nominal.
  ["AL30", 85_300, "ARS"],
  ["AL30D", 62, "USD"],
];

const cents = (value: number): string =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

function quotesFor(today: string): StoredQuotes {
  const fxRates: StoredQuotes["fxRates"] = [];
  for (let day = 0; day <= HISTORY_DAYS; day += 1) {
    const date = addDays(today, day - HISTORY_DAYS);
    // The dollars climb over the two years, with a small weekly wobble.
    const mep = 90_000 + day * 45 + (day % 5) * 150;
    fxRates.push(
      { kind: "mep", rate_date: date, sell: cents(mep) },
      { kind: "ccl", rate_date: date, sell: cents(mep + 4_000 + day * 2) },
      {
        kind: "official",
        rate_date: date,
        sell: cents(mep - 15_000 - day * 3),
      },
    );
  }
  const prices: StoredQuotes["prices"] = PRICES.flatMap(
    ([symbol, value, currency]) =>
      [0, 1, 2, 3].map((back) => ({
        symbol,
        price_date: addDays(today, -back),
        price: cents(value - back * Math.ceil(value / 200)),
        currency,
      })),
  );
  return { fxRates, prices };
}

type Placed = Pick<HoldingRow, "account" | "portfolio">;
const at = (account: SourceConnectionRow, portfolio: PortfolioRow): Placed => ({
  account: { id: account.id, institution: account.institution },
  portfolio,
});

// A movement as a fixture writes it: its kind, how many days back, and its
// fields.
type Charges = { fees?: string; taxes?: string };
type TradeStep = [
  kind: "opening_balance" | "purchase" | "sale",
  daysAgo: number,
  quantity: string,
  price: string,
  charges?: Charges,
];
type IncomeStep = [
  kind: "dividend" | "coupon",
  daysAgo: number,
  amount: string,
  charges?: Charges,
];
type Step = TradeStep | IncomeStep;
const isIncomeStep = (step: Step): step is IncomeStep =>
  step[0] === "dividend" || step[0] === "coupon";

type InstrumentHolding = {
  id: string;
  symbol: string;
  currency: "ARS" | "USD";
  placed: Placed;
  steps: Step[];
};

// Apple's monthly purchases and a few sales: the holding with the longest
// history, so its movements take more than one page.
const appleSteps = (): Step[] => {
  const steps: Step[] = [
    ["opening_balance", 700, "20", "9000", { fees: "45", taxes: "10" }],
  ];
  for (let month = 1; month <= 22; month += 1) {
    const daysAgo = 700 - month * 30;
    const price = String(9000 + month * 400);
    steps.push(
      month % 6 === 0
        ? ["sale", daysAgo, "5", price, { fees: "60", taxes: "12" }]
        : ["purchase", daysAgo, "2", price, { fees: "25" }],
    );
  }
  steps.push(["dividend", 45, "1800", { taxes: "270" }]);
  steps.push(["dividend", 200, "1500", { taxes: "225" }]);
  return steps;
};

const INSTRUMENT_HOLDINGS: InstrumentHolding[] = [
  {
    id: "c1000000-0000-4000-8000-000000000001",
    symbol: "BTC",
    currency: "USD",
    placed: at(ACCOUNTS.binance, PORTFOLIOS.largo),
    steps: [
      ["opening_balance", 690, "0.3", "30000", { fees: "5" }],
      ["purchase", 380, "0.1", "45000", { fees: "3" }],
      ["sale", 90, "0.15", "60000", { fees: "4" }],
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000002",
    symbol: "ETH",
    currency: "USD",
    placed: at(ACCOUNTS.binance, PORTFOLIOS.principal),
    steps: [
      ["opening_balance", 650, "2", "1800"],
      ["sale", 400, "0.5", "3000", { fees: "2" }],
      ["sale", 30, "0.5", "2600", { fees: "2" }],
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000003",
    symbol: "AAPL",
    currency: "ARS",
    placed: at(ACCOUNTS.iol, PORTFOLIOS.principal),
    steps: appleSteps(),
  },
  {
    id: "c1000000-0000-4000-8000-000000000004",
    symbol: "KO",
    currency: "ARS",
    placed: at(ACCOUNTS.cocos, PORTFOLIOS.largo),
    steps: [
      ["opening_balance", 500, "30", "8000", { fees: "40" }],
      ["dividend", 120, "2100", { taxes: "315" }],
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000005",
    symbol: "AL30",
    currency: "ARS",
    placed: at(ACCOUNTS.iol, PORTFOLIOS.corto),
    steps: [
      ["opening_balance", 600, "10000", "700", { fees: "350" }],
      ["coupon", 300, "30000"],
      ["sale", 60, "4000", "820", { fees: "160", taxes: "20" }],
      ["coupon", 20, "24000"],
    ],
  },
  // Sold to zero: closed, its sales still count.
  {
    id: "c1000000-0000-4000-8000-000000000006",
    symbol: "AL30D",
    currency: "USD",
    placed: at(ACCOUNTS.balanz, PORTFOLIOS.largo),
    steps: [
      ["opening_balance", 550, "5000", "0.55", { fees: "3" }],
      ["coupon", 360, "120"],
      ["sale", 100, "5000", "0.61", { fees: "3" }],
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000007",
    symbol: "FIMAPREA",
    currency: "ARS",
    placed: at(ACCOUNTS.balanz, PORTFOLIOS.corto),
    steps: [
      ["opening_balance", 400, "100000", "38"],
      ["purchase", 150, "50000", "41.5"],
    ],
  },
];

const OTHER_HOLDINGS: [id: string, columns: Record<string, unknown>, Placed][] =
  [
    [
      "c2000000-0000-4000-8000-000000000001",
      { asset_class: "cash", currency: "ARS", amount: "250000", label: null },
      at(ACCOUNTS.iol, PORTFOLIOS.corto),
    ],
    [
      "c2000000-0000-4000-8000-000000000002",
      { asset_class: "cash", currency: "USD", amount: "3200", label: null },
      at(ACCOUNTS.cocos, PORTFOLIOS.principal),
    ],
    [
      "c2000000-0000-4000-8000-000000000003",
      { asset_class: "fixed_term", currency: "ARS", amount: "1000000" },
      at(ACCOUNTS.balanz, PORTFOLIOS.corto),
    ],
    [
      "c2000000-0000-4000-8000-000000000004",
      {
        asset_class: "real_estate",
        currency: "USD",
        amount: "95000",
        label: "Departamento Palermo",
      },
      at(ACCOUNTS.cocos, PORTFOLIOS.largo),
    ],
  ];

const EMPTY_COLUMNS = {
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

let movementCount = 0;
const movementId = () =>
  `d1000000-0000-4000-8000-${String((movementCount += 1)).padStart(12, "0")}`;

// A step as a movement, with its date's rates read from the quotes.
function draft(
  holding: InstrumentHolding,
  step: Step,
  today: string,
  quotes: StoredQuotes,
): MovementDraft {
  const date = addDays(today, -step[1]);
  const { fx } = snapshotOn(quotes, date, {
    fxKinds: UNIT_FX_KINDS,
    symbols: [],
  }).snapshot;
  const common = {
    id: movementId(),
    holding_id: holding.id,
    date,
    currency: holding.currency,
    rates: fx,
  };
  if (isIncomeStep(step)) {
    const [kind, , amount, charges = {}] = step;
    return {
      ...common,
      kind,
      amount,
      fees: charges.fees ?? "0",
      taxes: charges.taxes ?? "0",
    };
  }
  const [kind, , quantity, price, charges = {}] = step;
  return {
    ...common,
    kind,
    quantity,
    price,
    fees: charges.fees ?? "0",
    taxes: charges.taxes ?? "0",
  };
}

export function buildFixtures(today: string): Fixtures {
  movementCount = 0;
  const quotes = quotesFor(today);
  const movements: Movement[] = [];
  const holdings: HoldingRow[] = [];
  const closed: string[] = [];
  for (const holding of INSTRUMENT_HOLDINGS) {
    const own: Movement[] = [];
    let quantity = "0";
    for (const step of holding.steps) {
      const movement = draft(holding, step, today, quotes);
      const admitted = admitMovement({ prior: null, after: own }, movement, {
        today,
      });
      if (!admitted.ok) {
        throw new Error(`Fixture movement refused: ${admitted.code}`);
      }
      own.push(movement as Movement);
      quantity = admitted.quantity;
    }
    movements.push(...own);
    const isClosed = quantity === "0";
    if (isClosed) closed.push(holding.id);
    holdings.push(
      rowOf(
        holding.id,
        {
          ...EMPTY_COLUMNS,
          asset_class: "instrument",
          instrument_symbol: holding.symbol,
          // A closed holding keeps the quantity it opened with, as no schema
          // takes a zero amount; nothing values or lists it.
          amount: isClosed ? own.find(isTrade)!.quantity : quantity,
        },
        holding.placed,
      ),
    );
  }
  for (const [id, columns, placed] of OTHER_HOLDINGS) {
    const term =
      columns.asset_class === "fixed_term"
        ? {
            annual_rate: "0.32",
            started_on: addDays(today, -20),
            matures_on: addDays(today, 10),
            label: null,
          }
        : columns.asset_class === "real_estate"
          ? { valued_on: addDays(today, -180) }
          : {};
    holdings.push(rowOf(id, { ...EMPTY_COLUMNS, ...columns, ...term }, placed));
  }
  return {
    referenceDollar: "mep",
    accounts: Object.values(ACCOUNTS),
    portfolios: Object.values(PORTFOLIOS),
    instruments: INSTRUMENTS,
    holdings,
    closed,
    movements,
    quotes,
  };
}
