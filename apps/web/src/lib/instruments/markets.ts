import type { ListingMarket } from "@plant/core";

// Exchanges that hold only crypto, and Argentine brokers that trade on
// BYMA, by the account's institution name.
const CRYPTO_EXCHANGES =
  /^(binance|nexo|bitso|ripio|roxom|lemon|buenbit|belo|kraken|coinbase|satoshitango|fiwind|bybit|okx)\b/i;
const BYMA_BROKERS =
  /^(iol|invertir ?online|ppi|portfolio personal|balanz|cocos|bull ?market|eco ?valores|allaria|adcap|iceberg|inviu|max ?capital|global ?valores|puente|cohen|santander|galicia|bbva|macro|icbc|supervielle|patagonia)\b/i;

// The markets an account's instruments are searched in: crypto for an
// exchange, BYMA for a broker, both for any other institution or none.
export function marketsFor(institution?: string | null): ListingMarket[] {
  const name = (institution ?? "").trim();
  if (CRYPTO_EXCHANGES.test(name)) return ["crypto"];
  if (BYMA_BROKERS.test(name)) return ["byma"];
  return ["byma", "crypto"];
}
