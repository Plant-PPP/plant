import type { PortfolioSetupGuardHint } from "@plant/shared";
import { NAME_LIMITS, type SetupTable } from "./limits";
import type { WriteResultCode } from "./write-result";

export const FAILED = "No pudimos guardar. Probá de nuevo.";

// A guard's hint names the row it refused for, whichever table was written.
const GUARD_MESSAGES: Record<PortfolioSetupGuardHint, string> = {
  last_active_portfolio: "Necesitás al menos una cartera activa.",
  portfolio_in_use:
    "Para archivar esta cartera, primero elegí otra en las cuentas que la usan o archivalas.",
  portfolio_archived: "Esa cartera está archivada.",
  holder_in_use:
    "Para archivar este titular, primero elegí otro en las cuentas que lo usan o archivalas.",
  holder_archived: "Ese titular está archivado.",
  portfolio_has_holdings:
    "Para archivar esta cartera, primero archivá sus tenencias.",
  source_connection_has_holdings:
    "Para archivar esta cuenta, primero archivá sus tenencias.",
  source_connection_archived: "Esa cuenta está archivada.",
};

export const invalidName = (max: number) =>
  `Usá entre 1 y ${max} letras, números o signos.`;

type WriteMessages = Record<WriteResultCode, string>;

export const WRITE_MESSAGES: Record<SetupTable, WriteMessages> = {
  portfolios: {
    ...GUARD_MESSAGES,
    duplicate: "Ya tenés una cartera con ese nombre.",
    not_found: "Esa cartera cambió hace un momento. Ya actualizamos la lista.",
    invalid: invalidName(NAME_LIMITS.portfolios.name),
    failed: FAILED,
  },
  holders: {
    ...GUARD_MESSAGES,
    duplicate: "Ya tenés un titular con ese nombre.",
    not_found: "Ese titular cambió hace un momento. Ya actualizamos la lista.",
    invalid: invalidName(NAME_LIMITS.holders.name),
    failed: FAILED,
  },
  source_connections: {
    ...GUARD_MESSAGES,
    // Accounts have no unique column.
    duplicate: FAILED,
    not_found: "Esa cuenta cambió hace un momento. Ya actualizamos la lista.",
    invalid: `En la institución, usá entre 1 y ${NAME_LIMITS.source_connections.institution} letras, números o signos.`,
    failed: FAILED,
  },
  holdings: {
    ...GUARD_MESSAGES,
    duplicate: "Ya tenés ese instrumento en esa cuenta y cartera.",
    source_connection_archived:
      "Esa cuenta está archivada. Restaurala en Cuentas primero.",
    portfolio_archived:
      "Esa cartera está archivada. Restaurala en Cuentas primero.",
    not_found: "Esa tenencia cambió hace un momento. Ya actualizamos la lista.",
    invalid: "Revisá los datos de la tenencia.",
    failed: FAILED,
  },
};

// A delete's refusals, which ask for a delete or a move where an archive's ask
// for an archive.
export function deleteMessages(messages: WriteMessages): WriteMessages {
  return {
    ...messages,
    portfolio_in_use:
      "Para borrar esta cartera, primero elegí otra en las cuentas que la usan.",
    portfolio_has_holdings:
      "Para borrar esta cartera, primero borrá o mové sus tenencias.",
    source_connection_has_holdings:
      "Para borrar esta cuenta, primero borrá sus tenencias.",
  };
}

// An account's select left unchosen, caught before the write.
export const CHOICE_MESSAGES = {
  institution: "Elegí una institución.",
  holder: "Elegí un titular.",
  portfolio: "Elegí una cartera por defecto.",
} as const;

// How the user shows where a holder would: an account with no holder is theirs.
export const SELF_HOLDER_LABEL = "Vos";

// The most accounts an in-use refusal names before "y N más".
const LISTED_ACCOUNTS = 3;

// The in-use refusals name the accounts behind them, when the page has them:
// two accounts with one name as "IOL (2)", the first few names, after a
// colon so no "y" has to agree with them.
export function inUseMessage(
  hint: "portfolio_in_use" | "holder_in_use",
  accounts: string[],
): string {
  if (accounts.length === 0) return GUARD_MESSAGES[hint];
  const counts = new Map<string, number>();
  for (const label of accounts) counts.set(label, (counts.get(label) ?? 0) + 1);
  const names = [...counts].map(([label, count]) =>
    count === 1 ? label : `${label} (${count})`,
  );
  const shown = names.slice(0, LISTED_ACCOUNTS).join(", ");
  const more = names.length - LISTED_ACCOUNTS;
  const list = more > 0 ? `${shown} y ${more} más` : shown;
  const which =
    accounts.length === 1 ? "archivá esta cuenta" : "archivá estas cuentas";
  return hint === "portfolio_in_use"
    ? `Para archivar esta cartera, primero elegí otra o ${which}: ${list}.`
    : `Para archivar este titular, primero elegí otro o ${which}: ${list}.`;
}
