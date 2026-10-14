import {
  type ConnectionDraft,
  type ConnectionProvider,
  connectionAdapters,
  type ReadOnlyCheck,
  type ReadPeriod,
} from "@plant/sources";
import type { Database } from "@plant/shared";

// An account's connection as the page shows it: the provider and the last
// characters of the field it names the credentials by, never a secret, and
// how its latest sync stands.
export type ApiKeyView = {
  provider: ConnectionProvider;
  keyHint: string;
  connectedOn: string;
  lastSync?: LastSync | null;
};

// The account's latest sync: its status, why it failed, and when it last
// changed, as a Buenos Aires day (YYYY-MM-DD) and time (HH:MM).
export type LastSync = {
  status: Database["public"]["Enums"]["import_status"];
  failure: Database["public"]["Enums"]["import_failure"] | null;
  on: string;
  at: string;
};

export type ApiKeyInput = {
  accountId: string;
  provider: ConnectionProvider;
  credentials: Record<string, string>;
  // The user confirmed the credentials only read, where the provider does
  // not say (or has none that only read).
  confirmedReadOnly: boolean;
};

// Why connecting was refused: input that does not parse, an account the
// user does not have open, one at another institution than the provider, a
// read-only confirmation missing, too many tries in a minute, credentials the
// provider refuses, ones that can do more than read, a provider that did not
// answer, or a failure.
export type ConnectCode =
  | "invalid"
  | "not_found"
  | "unsupported"
  | "unconfirmed"
  | "limited"
  | "rejected"
  | "not_read_only"
  | "unavailable"
  | "failed";
export type ConnectResult = { ok: true } | { ok: false; code: ConnectCode };

// Why a sync did not start: input that does not parse (or a draft the
// provider does not read), an account with no key (or archived), one
// syncing already, too many syncs in a minute, or a failure.
export type SyncCode =
  "invalid" | "not_connected" | "in_progress" | "limited" | "failed";
export type SyncResult =
  { ok: true; importId: string } | { ok: false; code: SyncCode };

export type DisconnectResult = { ok: boolean };

// The first day a sync of operations reads; the imports_sync_period
// constraint holds the same bound.
export const SYNC_PERIOD_START = "2000-01-01";

// What a sync reads: one from before syncs of operations has no draft and
// read holdings.
export const syncDraftOf = <Draft extends string>(draft: Draft | null) =>
  draft ?? "holdings";

export type ApiKeyActions = {
  connect: (input: ApiKeyInput) => Promise<ConnectResult>;
  disconnect: (accountId: string) => Promise<DisconnectResult>;
  sync: (
    accountId: string,
    draft: ConnectionDraft,
    period?: ReadPeriod,
  ) => Promise<SyncResult>;
};

// ── The registry ────────────────────────────────────────────────────────────
// Each provider as the app shows it: its name, the institutions it is, the
// label of each of its adapter's fields, how to make the credentials and,
// where the provider does not say they only read, what the user confirms.
type ProviderCopy = {
  name: string;
  institution: RegExp;
  fields: Record<string, string>;
  help: string;
  confirm?: string;
};

export const PROVIDERS: Record<ConnectionProvider, ProviderCopy> = {
  binance: {
    name: "Binance",
    institution: /^binance\b/i,
    fields: { apiKey: "Clave de API", apiSecret: "Clave secreta" },
    help: 'En Binance, creá una clave de API con solo "Habilitar lectura". Si la clave puede operar, retirar o transferir, no la aceptamos.',
  },
  wallbit: {
    name: "Wallbit",
    institution: /^wallbit\b/i,
    fields: { apiKey: "API key" },
    help: 'En Wallbit, andá a Configuración → API Keys y creá una key con el permiso "read" solamente, sin "trade". Si Wallbit nos avisa que la key puede operar, la rechazamos.',
    confirm: 'Confirmo que la key tiene solo el permiso "read".',
  },
  ibkr: {
    name: "Interactive Brokers",
    institution: /^(interactive brokers|ibkr)\b/i,
    fields: { token: "Token de Flex", queryId: "ID de la Flex Query" },
    help: "En el Client Portal, entrá a Rendimiento e informes → Flex Queries y creá una Activity Flex Query en XML con Open Positions, Cash Report, Trades y Cash Transactions; anotá su ID. Después activá Flex Web Service en la misma pantalla y generá un token. Ese token solo pide tus informes: no puede operar.",
  },
  nexo: {
    name: "Nexo",
    institution: /^nexo\b/i,
    fields: { apiKey: "API key", apiSecret: "API secret" },
    help: "En Nexo Pro, andá a API Management y creá una key con el rol VIEWER, que solo puede leer. Leemos los saldos de Nexo Pro; los de tu cuenta de ahorro cargalos con un resumen.",
    confirm: "Confirmo que la key tiene el rol VIEWER (solo lectura).",
  },
  iol: {
    name: "InvertirOnline",
    institution: /^(iol|invertir ?online)\b/i,
    fields: { username: "Usuario de IOL", password: "Contraseña" },
    help: "IOL no tiene un acceso de solo lectura: se conecta con tu usuario y contraseña. Plant los guarda cifrados y solo los usa para leer tu portafolio y tu estado de cuenta; nunca opera.",
    confirm:
      "Entiendo que IOL no tiene acceso de solo lectura y que Plant solo lee.",
  },
  roxom: {
    name: "Roxom",
    institution: /^roxom\b/i,
    fields: { apiKey: "Key ID", privateKey: "Clave privada" },
    help: 'En Roxom, tocá tu perfil → API → "Generate API Key" y copiá el Key ID y la clave privada, que Roxom muestra una sola vez (el bloque entero, de "-----BEGIN PRIVATE KEY-----" a "-----END PRIVATE KEY-----"). Roxom no tiene keys de solo lectura: Plant guarda la clave cifrada y solo la usa para leer tus saldos; nunca opera.',
    confirm:
      "Entiendo que la key de Roxom no es de solo lectura y que Plant solo lee.",
  },
  mercadopago: {
    name: "Mercado Pago",
    institution: /^mercado ?pago\b/i,
    fields: { accessToken: "Access Token de producción" },
    help: 'En Mercado Pago Developers, entrá a "Tus integraciones", creá una aplicación y copiá su Access Token de producción (empieza con APP_USR-). Leemos el dinero disponible en tu cuenta con el reporte de liberaciones: si nunca lo usaste, generalo una vez desde Reportes → Liberaciones en Mercado Pago para que quede activado. Mercado Pago tarda unos minutos en generarlo; lo que rinde en Mercado Fondo y tus otros movimientos cargalos con un resumen.',
    confirm:
      "Entiendo que el Access Token de Mercado Pago tiene todos los permisos y que Plant solo lee.",
  },
  bitso: {
    name: "Bitso",
    institution: /^bitso\b/i,
    fields: { apiKey: "API key", apiSecret: "API secret" },
    help: 'En Bitso, andá a Perfil → API y creá una key nueva solo para Plant, con los permisos "View balances" y "View account information" solamente, sin "Place orders", "Make withdrawals" ni "Perform security actions". No la uses en otra app: Bitso rechaza los pedidos de una key que otro programa usa a la vez. Leemos tus saldos.',
    confirm:
      'Confirmo que la key tiene solo "View balances" y "View account information".',
  },
  ripio: {
    name: "Ripio Trade",
    institution: /^ripio\b/i,
    fields: { apiToken: "API Token", secretKey: "Secret Key" },
    help: 'En Ripio Trade, entrá a API (trade.ripio.com/market/api/token) y creá credenciales con el acceso "Read" solamente, sin "Buy/Sell" ni retiros. Copiá el API Token y la Secret Key, que se muestra una sola vez. Leemos los saldos de Ripio Trade; los de la app de Ripio cargalos con un resumen.',
    confirm: 'Confirmo que las credenciales tienen solo el acceso "Read".',
  },
};

// The provider an account's institution is, by its name; null for any
// other institution, whose page offers no connection.
export function providerOf(institution: string): ConnectionProvider | null {
  const name = institution.trim();
  const found = (Object.keys(PROVIDERS) as ConnectionProvider[]).find(
    (provider) => PROVIDERS[provider].institution.test(name),
  );
  return found ?? null;
}

// Whether the user must confirm the credentials only read.
export const needsConfirmation = (readOnly: ReadOnlyCheck) =>
  readOnly === "confirmed" || readOnly === "none";

// What the connect card shows for a provider: its adapter's fields with
// their labels, what it reads, and whether the user confirms read-only.
export type ConnectionForm = {
  provider: ConnectionProvider;
  name: string;
  fields: { name: string; label: string; secret: boolean }[];
  // The label of the field the connection is named by.
  hint: string;
  drafts: ConnectionDraft[];
  help: string;
  confirm: string | null;
};

export function connectionForm(provider: ConnectionProvider): ConnectionForm {
  const adapter = connectionAdapters()[provider]();
  const copy = PROVIDERS[provider];
  return {
    provider,
    name: copy.name,
    fields: adapter.fields.map((field) => ({
      ...field,
      label: copy.fields[field.name] ?? field.name,
    })),
    hint: copy.fields[adapter.hintField] ?? adapter.hintField,
    drafts: [...adapter.drafts],
    help: copy.help,
    confirm: needsConfirmation(adapter.readOnly)
      ? (copy.confirm ?? null)
      : null,
  };
}

// The last letters or digits of the field the provider is named by, as the
// page shows them.
export const keyHintOf = (value: string) =>
  value.replace(/[^A-Za-z0-9]/g, "").slice(-4) || "0";

// What the user reads when connecting to the provider named `name` is
// refused.
export const connectMessages = (name: string): Record<ConnectCode, string> => ({
  invalid: "Revisá los datos: falta alguno o tiene caracteres que no van.",
  not_found: "No encontramos esa cuenta.",
  unsupported: `Esta cuenta no es de ${name}.`,
  unconfirmed: "Confirmá que el acceso es de solo lectura para conectarlo.",
  limited: "Probaste muchas veces. Esperá un minuto y volvé a intentar.",
  rejected: `${name} rechazó los datos. Revisá que los copiaste bien y que sigan activos.`,
  not_read_only:
    "La clave puede operar, retirar o transferir. Creá una de solo lectura.",
  unavailable: `${name} no respondió. Probá de nuevo en unos minutos.`,
  failed: "No pudimos guardar la conexión. Probá de nuevo más tarde.",
});

export const SYNC_MESSAGES: Record<SyncCode, string> = {
  invalid: "No encontramos esa cuenta.",
  not_connected: "La cuenta no tiene una conexión.",
  in_progress: "Ya estamos sincronizando esta cuenta.",
  limited:
    "Sincronizaste muchas veces seguidas. Esperá un minuto y volvé a intentar.",
  failed: "No pudimos sincronizar. Probá de nuevo más tarde.",
};
