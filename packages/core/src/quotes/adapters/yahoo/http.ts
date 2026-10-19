import { PLANT_USER_AGENT, usTicker } from "@plant/shared";

export const YAHOO_BASE_URL = "https://query1.finance.yahoo.com";

// Yahoo answers 429 to a request without a client's name.
export const YAHOO_HEADERS = { "User-Agent": PLANT_USER_AGENT } as const;

// The exchanges of a US listing as Yahoo codes them: NYSE, the three Nasdaq
// tiers, NYSE Arca, NYSE American and Cboe BZX.
export const US_EXCHANGES: ReadonlySet<string> = new Set([
  "NYQ",
  "NMS",
  "NGM",
  "NCM",
  "NAS",
  "PCX",
  "ASE",
  "BTS",
]);

// A catalog US listing as Yahoo names it: its ticker, a class share with a
// dash, as the catalog writes it (BRK-B).
export const yahooTicker = (symbol: string): string | null => usTicker(symbol);
