import {
  admitMovement,
  type Charge,
  isTrade,
  type ManualPrice,
  type Movement,
  type MovementDraft,
  type ReferenceDollar,
  type StoredQuotes,
  snapshotOn,
  UNIT_FX_KINDS,
} from "@plant/core";
import { addDays, exactOf, times, toDecimal } from "@plant/shared";

import { rowOf } from "@/components/holdings/holding-fields";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";

// The prototype's made-up data, sized like most users' net worth: a dozen
// holdings across CEDEARs and crypto, some cash and one apartment, with two
// years of purchases, sales and dividends, the dollar rates and prices of every
// day, and the manual prices of what the feeds do not price. Built from
// `today`, so the same day gives the same data.
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
  manualPrices: ManualPrice[];
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
  { symbol: "BTC", name: "Bitcoin", currency: "USD", type: "crypto" },
  { symbol: "ETH", name: "Ethereum", currency: "USD", type: "crypto" },
  { symbol: "SOL", name: "Solana", currency: "USD", type: "crypto" },
  { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
  { symbol: "KO", name: "Coca-Cola", currency: "ARS", type: "cedear" },
  { symbol: "MELI", name: "MercadoLibre", currency: "ARS", type: "cedear" },
  { symbol: "MSFT", name: "Microsoft", currency: "ARS", type: "cedear" },
  { symbol: "NVDA", name: "NVIDIA", currency: "ARS", type: "cedear" },
  { symbol: "SPY", name: "SPDR S&P 500", currency: "ARS", type: "cedear" },
  { symbol: "TSLA", name: "Tesla", currency: "ARS", type: "cedear" },
  { symbol: "AL30", name: "Bonar 2030", currency: "ARS", type: "bond" },
];

// The dollars in cents, `day` days into the history: they climb over the two
// years with a small weekly wobble. CEDEARs follow the CCL.
const mepCents = (day: number) => 90_000 + day * 45 + (day % 5) * 150;
const cclCents = (day: number) => mepCents(day) + 4_000 + day * 2;
const officialCents = (day: number) => mepCents(day) - 15_000 - day * 3;

// How a symbol's dollar price moves: today's, what share of it it was two
// years back (in percent), and a wave of `amplitude` per mille every
// `period` days on top.
type PriceModel = {
  usdCents: number;
  startPercent: number;
  amplitude: number;
  period: number;
  // A CEDEAR's price is its dollar price at the CCL, in pesos.
  cedear?: true;
};

const MODELS: Record<string, PriceModel> = {
  BTC: { usdCents: 6_512_345, startPercent: 45, amplitude: 120, period: 97 },
  ETH: { usdCents: 251_020, startPercent: 70, amplitude: 150, period: 71 },
  SOL: { usdCents: 15_230, startPercent: 60, amplitude: 200, period: 53 },
  AAPL: {
    usdCents: 1_480,
    startPercent: 80,
    amplitude: 60,
    period: 89,
    cedear: true,
  },
  KO: {
    usdCents: 520,
    startPercent: 92,
    amplitude: 40,
    period: 120,
    cedear: true,
  },
  MELI: {
    usdCents: 2_050,
    startPercent: 70,
    amplitude: 90,
    period: 61,
    cedear: true,
  },
  NVDA: {
    usdCents: 910,
    startPercent: 40,
    amplitude: 110,
    period: 67,
    cedear: true,
  },
  SPY: {
    usdCents: 3_100,
    startPercent: 78,
    amplitude: 40,
    period: 101,
    cedear: true,
  },
  TSLA: {
    usdCents: 1_800,
    startPercent: 60,
    amplitude: 150,
    period: 59,
    cedear: true,
  },
};

// The feeds price every symbol above but KO, which takes manual prices.
const FED = ["BTC", "ETH", "SOL", "AAPL", "MELI", "NVDA", "SPY", "TSLA"];

// A symbol's price in cents `daysAgo` days back, in its currency.
function priceCents(symbol: string, daysAgo: number): number {
  const model = MODELS[symbol];
  if (!model) throw new RangeError(`No price model for ${symbol}`);
  const day = HISTORY_DAYS - daysAgo;
  const trend =
    (model.usdCents *
      (model.startPercent * HISTORY_DAYS + (100 - model.startPercent) * day)) /
    (100 * HISTORY_DAYS);
  // A triangle wave from -500 to 500.
  const phase = (daysAgo % model.period) * 2000;
  const wave = Math.abs(phase / model.period - 1000) - 500;
  const usd = (trend * (1000 + (model.amplitude * wave) / 500)) / 1000;
  const cents = model.cedear ? (usd * cclCents(day)) / 100 : usd;
  return Math.max(1, Math.round(cents));
}

const decimal = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

const priceOn = (symbol: string, daysAgo: number): string =>
  decimal(priceCents(symbol, daysAgo));

function quotesFor(today: string): StoredQuotes {
  const fxRates: StoredQuotes["fxRates"] = [];
  const prices: StoredQuotes["prices"] = [];
  for (let day = 0; day <= HISTORY_DAYS; day += 1) {
    const daysAgo = HISTORY_DAYS - day;
    const date = addDays(today, -daysAgo);
    fxRates.push(
      { kind: "mep", rate_date: date, sell: decimal(mepCents(day)) },
      { kind: "ccl", rate_date: date, sell: decimal(cclCents(day)) },
      { kind: "official", rate_date: date, sell: decimal(officialCents(day)) },
    );
    for (const symbol of FED) {
      prices.push({
        symbol,
        price_date: date,
        price: priceOn(symbol, daysAgo),
        currency: MODELS[symbol]!.cedear ? "ARS" : "USD",
      });
    }
  }
  return { fxRates, prices };
}

// KO's prices as the user stated them, the latest twelve days back.
const manualPricesFor = (today: string): ManualPrice[] =>
  [75, 40, 12].map((daysAgo) => ({
    symbol: "KO",
    price_date: addDays(today, -daysAgo),
    price: priceOn("KO", daysAgo),
    currency: "ARS",
  }));

type Placed = Pick<HoldingRow, "account" | "portfolio">;
const at = (account: SourceConnectionRow, portfolio: PortfolioRow): Placed => ({
  account: { id: account.id, institution: account.institution },
  portfolio,
});

// How each account charges a trade of `gross` cents: its commission and
// market fee in per ten thousand, with VAT on the commission.
type Broker = { commission: number; market: number; vat: boolean };
const BROKERS: Record<string, Broker> = {
  IOL: { commission: 50, market: 8, vat: true },
  Balanz: { commission: 40, market: 8, vat: true },
  Cocos: { commission: 30, market: 8, vat: true },
  Binance: { commission: 10, market: 0, vat: false },
};

function brokerCharges(institution: string, grossCents: number): Charge[] {
  const broker = BROKERS[institution]!;
  const commission = Math.max(
    1,
    Math.round((grossCents * broker.commission) / 10_000),
  );
  const market = Math.round((grossCents * broker.market) / 10_000);
  const vat = broker.vat ? Math.round((commission * 21) / 100) : 0;
  return [
    { kind: "commission", label: null, amount: decimal(commission) },
    ...(market > 0
      ? [{ kind: "market_fee" as const, label: null, amount: decimal(market) }]
      : []),
    ...(vat > 0
      ? [{ kind: "vat" as const, label: null, amount: decimal(vat) }]
      : []),
  ];
}

// A step as a fixture writes it: a trade of a quantity at that day's price,
// or a dividend in dollars with its withholding, `daysAgo` days back.
type TradeStep = {
  kind: "opening_balance" | "purchase" | "sale";
  daysAgo: number;
  quantity: string;
  reference?: string;
  operation?: string;
};
type DividendStep = {
  kind: "dividend";
  daysAgo: number;
  usd: string;
  withheld: string;
};
type Step = TradeStep | DividendStep;

const buy = (daysAgo: number, quantity: string, reference?: string): Step => ({
  kind: "purchase",
  daysAgo,
  quantity,
  reference,
});
const sell = (daysAgo: number, quantity: string, reference?: string): Step => ({
  kind: "sale",
  daysAgo,
  quantity,
  reference,
});
const open = (daysAgo: number, quantity: string): Step => ({
  kind: "opening_balance",
  daysAgo,
  quantity,
});
const dividend = (daysAgo: number, usd: string, withheld: string): Step => ({
  kind: "dividend",
  daysAgo,
  usd,
  withheld,
});

// A purchase every `every` days from `first` days back, of `quantity` each.
const monthly = (
  first: number,
  every: number,
  times: number,
  quantity: string,
): Step[] =>
  Array.from({ length: times }, (_, n) =>
    buy(first - n * every, quantity, `OP-${first - n * every}`),
  );

type InstrumentHolding = {
  id: string;
  symbol: string;
  currency: "ARS" | "USD";
  placed: Placed;
  steps: Step[];
};

const ETH_SPLIT = "f2000000-0000-4000-8000-000000000001";

const INSTRUMENT_HOLDINGS: InstrumentHolding[] = [
  {
    id: "c1000000-0000-4000-8000-000000000001",
    symbol: "BTC",
    currency: "USD",
    placed: at(ACCOUNTS.binance, PORTFOLIOS.largo),
    steps: [
      open(700, "0.25"),
      ...monthly(640, 60, 10, "0.02"),
      sell(150, "0.1", "BIN-48213"),
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000002",
    symbol: "ETH",
    currency: "USD",
    placed: at(ACCOUNTS.binance, PORTFOLIOS.principal),
    steps: [
      open(650, "1.5"),
      sell(400, "0.5"),
      // One purchase split with the holding in Largo plazo.
      {
        kind: "purchase",
        daysAgo: 120,
        quantity: "0.6",
        operation: ETH_SPLIT,
        reference: "BIN-77310",
      },
      sell(30, "0.3"),
    ],
  },
  // Started by its part of the purchase split with Principal.
  {
    id: "c1000000-0000-4000-8000-000000000003",
    symbol: "ETH",
    currency: "USD",
    placed: at(ACCOUNTS.binance, PORTFOLIOS.largo),
    steps: [
      {
        kind: "purchase",
        daysAgo: 120,
        quantity: "0.4",
        operation: ETH_SPLIT,
        reference: "BIN-77310",
      },
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000004",
    symbol: "SOL",
    currency: "USD",
    placed: at(ACCOUNTS.binance, PORTFOLIOS.corto),
    steps: [buy(300, "20"), buy(200, "10"), sell(60, "12")],
  },
  {
    id: "c1000000-0000-4000-8000-000000000005",
    symbol: "AAPL",
    currency: "ARS",
    placed: at(ACCOUNTS.iol, PORTFOLIOS.principal),
    steps: [
      open(700, "40"),
      ...monthly(670, 30, 22, "4"),
      sell(400, "20", "IOL-58120"),
      sell(160, "15", "IOL-61877"),
      dividend(320, "9.60", "2.88"),
      dividend(230, "9.80", "2.94"),
      dividend(140, "10.10", "3.03"),
      dividend(50, "10.40", "3.12"),
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000006",
    symbol: "KO",
    currency: "ARS",
    placed: at(ACCOUNTS.cocos, PORTFOLIOS.largo),
    steps: [
      open(500, "60"),
      buy(330, "20"),
      dividend(410, "11.70", "3.51"),
      dividend(320, "11.70", "3.51"),
      dividend(230, "15.30", "4.59"),
      dividend(140, "15.30", "4.59"),
      dividend(50, "15.90", "4.77"),
    ],
  },
  {
    id: "c1000000-0000-4000-8000-000000000007",
    symbol: "MELI",
    currency: "ARS",
    placed: at(ACCOUNTS.iol, PORTFOLIOS.principal),
    steps: [buy(540, "15"), buy(380, "10"), buy(95, "8")],
  },
  {
    id: "c1000000-0000-4000-8000-000000000008",
    symbol: "NVDA",
    currency: "ARS",
    placed: at(ACCOUNTS.balanz, PORTFOLIOS.largo),
    steps: [...monthly(360, 30, 12, "10"), sell(45, "30", "BAL-30418")],
  },
  {
    id: "c1000000-0000-4000-8000-000000000009",
    symbol: "SPY",
    currency: "ARS",
    placed: at(ACCOUNTS.balanz, PORTFOLIOS.largo),
    steps: [
      ...monthly(715, 30, 24, "6"),
      dividend(640, "4.10", "1.23"),
      dividend(550, "4.20", "1.26"),
      dividend(460, "4.30", "1.29"),
      dividend(370, "4.40", "1.32"),
      dividend(280, "4.50", "1.35"),
      dividend(190, "4.60", "1.38"),
      dividend(100, "4.70", "1.41"),
      dividend(10, "4.80", "1.44"),
    ],
  },
  // Sold to zero: closed, its sales still count.
  {
    id: "c1000000-0000-4000-8000-000000000010",
    symbol: "TSLA",
    currency: "ARS",
    placed: at(ACCOUNTS.cocos, PORTFOLIOS.corto),
    steps: [buy(420, "25"), buy(350, "15"), sell(100, "40", "COC-90215")],
  },
];

const OTHER_HOLDINGS: [id: string, columns: Record<string, unknown>, Placed][] =
  [
    [
      "c2000000-0000-4000-8000-000000000001",
      { asset_class: "cash", currency: "ARS", amount: "350000", label: null },
      at(ACCOUNTS.iol, PORTFOLIOS.corto),
    ],
    [
      "c2000000-0000-4000-8000-000000000002",
      { asset_class: "cash", currency: "USD", amount: "2500", label: null },
      at(ACCOUNTS.cocos, PORTFOLIOS.principal),
    ],
    [
      "c2000000-0000-4000-8000-000000000003",
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

// A step as a movement, at its day's price and rates.
function draft(
  holding: InstrumentHolding,
  step: Step,
  today: string,
  quotes: StoredQuotes,
): MovementDraft {
  const date = addDays(today, -step.daysAgo);
  const { fx } = snapshotOn(quotes, date, {
    fxKinds: UNIT_FX_KINDS,
    symbols: [],
  }).snapshot;
  const id = movementId();
  const common = {
    id,
    holding_id: holding.id,
    operation_id:
      (step.kind !== "dividend" && step.operation) || id.replace(/^d1/, "f1"),
    date,
    note: null,
    rates: fx,
  };
  if (step.kind === "dividend") {
    return {
      ...common,
      kind: "dividend",
      currency: "USD",
      amount: step.usd,
      charges: [{ kind: "tax", label: "Retención", amount: step.withheld }],
      reference: null,
    };
  }
  const priceCentsNow = priceCents(holding.symbol, step.daysAgo);
  // The trade's value in whole cents, from the exact quantity.
  const gross = Number(
    toDecimal(times(exactOf(String(priceCentsNow)), exactOf(step.quantity)), 0),
  );
  return {
    ...common,
    kind: step.kind,
    currency: holding.currency,
    quantity: step.quantity,
    price: decimal(priceCentsNow),
    charges:
      step.kind === "opening_balance"
        ? []
        : brokerCharges(holding.placed.account.institution, gross),
    reference: step.reference ?? null,
  };
}

const typeOf = (symbol: string) =>
  INSTRUMENTS.find((row) => row.symbol === symbol)?.type ?? null;

export function buildFixtures(today: string): Fixtures {
  movementCount = 0;
  const quotes = quotesFor(today);
  const movements: Movement[] = [];
  const holdings: HoldingRow[] = [];
  const closed: string[] = [];
  for (const holding of INSTRUMENT_HOLDINGS) {
    const own: Movement[] = [];
    let quantity = "0";
    const steps = [...holding.steps].sort((a, b) => b.daysAgo - a.daysAgo);
    for (const step of steps) {
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
        { ...holding.placed, instrumentType: typeOf(holding.symbol) },
      ),
    );
  }
  for (const [id, columns, placed] of OTHER_HOLDINGS) {
    const valued =
      columns.asset_class === "real_estate"
        ? { valued_on: addDays(today, -180) }
        : {};
    holdings.push(
      rowOf(
        id,
        { ...EMPTY_COLUMNS, ...columns, ...valued },
        { ...placed, instrumentType: null },
      ),
    );
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
    manualPrices: manualPricesFor(today),
  };
}
