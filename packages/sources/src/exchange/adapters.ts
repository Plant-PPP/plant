import { BINANCE_BASE_URL, binanceSource } from "./binance";
import type { ExchangeAdapters } from "./port";

// Each exchange's adapter against its real API, for the composition roots
// that connect a key and that sync an account.
export function exchangeAdapters(
  options: { fetch?: typeof fetch } = {},
): ExchangeAdapters {
  return {
    binance: () => binanceSource({ baseUrl: BINANCE_BASE_URL, ...options }),
  };
}
