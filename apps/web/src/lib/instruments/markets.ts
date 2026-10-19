import type { ListingMarket } from "@plant/core";

// Exchanges that hold only crypto, Argentine brokers that trade on BYMA, and
// foreign brokers that trade on the US exchanges, by the account's
// institution name.
const CRYPTO_EXCHANGES =
  /^(binance|nexo|bitso|ripio|roxom|lemon|buenbit|belo|kraken|coinbase|satoshitango|fiwind|bybit|okx)\b/i;
const BYMA_BROKERS =
  /^(iol|invertir ?online|ppi|portfolio personal|balanz|cocos|bull ?market|eco ?valores|allaria|adcap|iceberg|inviu|max ?capital|global ?valores|puente|cohen|santander|galicia|bbva|macro|icbc|supervielle|patagonia)\b/i;
const FOREIGN_BROKERS =
  /^(interactive ?brokers|ibkr|wallbit|charles schwab|schwab|firstrade|tastytrade|webull|robinhood|etoro|hapi)\b/i;

// The markets an account's instruments are searched in: crypto for an
// exchange, BYMA for an Argentine broker, the US exchanges and crypto for a
// foreign one, every market for any other institution or none.
export function marketsFor(institution?: string | null): ListingMarket[] {
  const name = (institution ?? "").trim();
  if (CRYPTO_EXCHANGES.test(name)) return ["crypto"];
  if (BYMA_BROKERS.test(name)) return ["byma"];
  if (FOREIGN_BROKERS.test(name)) return ["us", "crypto"];
  return ["byma", "us", "crypto"];
}
