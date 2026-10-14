import type { ExchangeProvider } from "@plant/sources";

// An account's exchange key as the page shows it: never the key, only its
// last four characters.
export type ApiKeyView = {
  provider: ExchangeProvider;
  keyHint: string;
  connectedOn: string;
};

export type ApiKeyInput = {
  accountId: string;
  provider: ExchangeProvider;
  apiKey: string;
  apiSecret: string;
};

// Why connecting a key was refused: input that does not parse, an account
// the user does not have open, one at another institution than the
// exchange, a key the exchange refuses, one that can do
// more than read, an exchange that did not answer, a deployment with no
// server key to seal it with, or a failure.
export type ConnectCode =
  | "invalid"
  | "not_found"
  | "unsupported"
  | "rejected"
  | "not_read_only"
  | "unavailable"
  | "unconfigured"
  | "failed";
export type ConnectResult = { ok: true } | { ok: false; code: ConnectCode };

// Why a sync did not start: input that does not parse, an account with no
// key (or archived), one syncing already, or a failure.
export type SyncCode = "invalid" | "not_connected" | "in_progress" | "failed";
export type SyncResult =
  { ok: true; importId: string } | { ok: false; code: SyncCode };

export type DisconnectResult = { ok: boolean };

export type ApiKeyActions = {
  connect: (input: ApiKeyInput) => Promise<ConnectResult>;
  disconnect: (accountId: string) => Promise<DisconnectResult>;
  sync: (accountId: string) => Promise<SyncResult>;
};

export const EXCHANGE_NAMES: Record<ExchangeProvider, string> = {
  binance: "Binance",
};

// The exchange an account's institution is, by its name; null for any other
// institution, whose page offers no key.
export function exchangeOf(institution: string): ExchangeProvider | null {
  return /^binance\b/i.test(institution.trim()) ? "binance" : null;
}

export const CONNECT_MESSAGES: Record<ConnectCode, string> = {
  invalid: "Revisá la clave y el secreto: son letras y números, sin espacios.",
  not_found: "No encontramos esa cuenta.",
  unsupported: "Solo podés conectar la clave a una cuenta de Binance.",
  rejected:
    "Binance rechazó la clave. Revisá que la copiaste bien y que siga activa.",
  not_read_only:
    "La clave puede operar, retirar o transferir. Creá una con solo lectura.",
  unavailable: "Binance no respondió. Probá de nuevo en unos minutos.",
  unconfigured: "No pudimos guardar la clave. Probá de nuevo más tarde.",
  failed: "No pudimos guardar la clave. Probá de nuevo más tarde.",
};

export const SYNC_MESSAGES: Record<SyncCode, string> = {
  invalid: "No encontramos esa cuenta.",
  not_connected: "La cuenta no tiene una clave conectada.",
  in_progress: "Ya estamos sincronizando esta cuenta.",
  failed: "No pudimos sincronizar. Probá de nuevo más tarde.",
};
