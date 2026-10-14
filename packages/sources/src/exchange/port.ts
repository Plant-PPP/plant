import { z } from "zod";

import type { HoldingsReading } from "../port";

// The exchanges an account may connect by API, as public.account_api_keys
// and public.imports name them.
export const exchangeProviderSchema = z.enum(["binance"]);
export type ExchangeProvider = z.infer<typeof exchangeProviderSchema>;

// A read-only API key and its secret, as the exchange issued them.
export type ExchangeCredentials = { apiKey: string; apiSecret: string };

// The shape an exchange's key and secret take: letters and digits, as
// Binance issues them.
export const exchangeCredentialsSchema = z
  .object({
    apiKey: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
    apiSecret: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
  })
  .strict();

// Reading an account's balances from its exchange. Both calls throw a
// SourceError: connection_rejected when the exchange refuses the key,
// connection_not_read_only when the key can trade, withdraw or transfer, and
// a retryable extraction_failed when the exchange does not answer.
export interface ExchangeSourcePort {
  readonly provider: ExchangeProvider;
  // Whether the key reads and does nothing else.
  checkReadOnly(credentials: ExchangeCredentials): Promise<void>;
  // The account's balances as a draft of holdings, after checking the key
  // again: the user may have widened it since connecting.
  read(credentials: ExchangeCredentials): Promise<HoldingsReading>;
}

// Builds each exchange's adapter; the composition root supplies them.
export type ExchangeAdapters = {
  [P in ExchangeProvider]: () => ExchangeSourcePort;
};
