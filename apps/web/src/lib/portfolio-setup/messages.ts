import type { PortfolioSetupGuardHint } from "@plant/shared";
import { NAME_LIMITS, type SetupTable } from "./limits";
import type { WriteResultCode } from "./write-result";

const FAILED = "No pudimos guardar. Probá de nuevo.";

// A guard's hint names the row it refused for, whichever table was written.
const GUARD_MESSAGES: Record<PortfolioSetupGuardHint, string> = {
  last_active_portfolio: "Necesitás al menos una cartera activa.",
  portfolio_in_use:
    "Para archivar esta cartera, primero elegí otra en las cuentas que la usan o archivalas.",
  portfolio_archived: "Esa cartera está archivada.",
  holder_in_use:
    "Para archivar este titular, primero elegí otro en las cuentas que lo usan o archivalas.",
  holder_archived: "Ese titular está archivado.",
};

const invalidName = (max: number) =>
  `Usá entre 1 y ${max} letras, números o signos.`;

export const WRITE_MESSAGES: Record<
  SetupTable,
  Record<WriteResultCode, string>
> = {
  portfolios: {
    ...GUARD_MESSAGES,
    duplicate_name: "Ya tenés una cartera con ese nombre.",
    not_found: "Esa cartera cambió hace un momento. Ya actualizamos la lista.",
    invalid: invalidName(NAME_LIMITS.portfolios.name),
    failed: FAILED,
  },
  holders: {
    ...GUARD_MESSAGES,
    duplicate_name: "Ya tenés un titular con ese nombre.",
    not_found: "Ese titular cambió hace un momento. Ya actualizamos la lista.",
    invalid: invalidName(NAME_LIMITS.holders.name),
    failed: FAILED,
  },
  source_connections: {
    ...GUARD_MESSAGES,
    // Accounts have no unique column.
    duplicate_name: FAILED,
    not_found: "Esa cuenta cambió hace un momento. Ya actualizamos la lista.",
    invalid: `En la institución, usá entre 1 y ${NAME_LIMITS.source_connections.institution} letras, números o signos.`,
    failed: FAILED,
  },
};

// An account's select left unchosen, caught before the write.
export const CHOICE_MESSAGES = {
  institution: "Elegí una institución.",
  holder: "Elegí un titular.",
  portfolio: "Elegí una cartera por defecto.",
} as const;

// How the user shows where a holder would: an account with no holder is theirs.
export const SELF_HOLDER_LABEL = "Vos";

// How an account is named in copy: "tu IOL", or "IOL de Lucía".
export function accountLabel(
  institution: string,
  holderName: string | null,
): string {
  return holderName === null
    ? `tu ${institution}`
    : `${institution} de ${holderName}`;
}

// The most accounts an in-use refusal names before "y N más".
const LISTED_ACCOUNTS = 3;

// The in-use refusals name the accounts behind them, when the page has them:
// two accounts with one name as "tu IOL (2)", the first few names, after a
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
