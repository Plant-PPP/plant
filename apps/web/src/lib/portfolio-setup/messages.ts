import type { PortfolioSetupGuardHint } from "@plant/shared";
import { NAME_LIMITS } from "./limits";
import type { WriteResultCode } from "./write-result";

export type SetupTable = keyof typeof NAME_LIMITS;

const FAILED = "No pudimos guardar. Probá de nuevo.";

// A guard's hint names the row it refused for, whichever table was written.
const GUARD_MESSAGES: Record<PortfolioSetupGuardHint, string> = {
  last_active_portfolio: "Necesitás al menos una cartera activa.",
  portfolio_in_use: "Esa cartera es la de una cuenta activa.",
  portfolio_archived: "Esa cartera está archivada.",
  holder_in_use: "Ese titular es el de una cuenta activa.",
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
  holder: "Elegí un titular.",
  portfolio: "Elegí una cartera por defecto.",
} as const;

// "IOL", "IOL y Balanz", "IOL, Balanz y Cocos".
function listOf(names: string[]): string {
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

// The in-use refusals name the accounts behind them, when the page has them.
export function inUseMessage(
  hint: "portfolio_in_use" | "holder_in_use",
  institutions: string[],
): string {
  if (institutions.length === 0) return GUARD_MESSAGES[hint];
  const subject =
    hint === "portfolio_in_use" ? "Esa cartera es la" : "Ese titular es el";
  const accounts =
    institutions.length === 1 ? "una cuenta activa" : "cuentas activas";
  return `${subject} de ${accounts}: ${listOf(institutions)}.`;
}
