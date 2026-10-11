import { NAME_LIMITS } from "@/lib/portfolio-setup/limits";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import {
  idSchema,
  nameInputSchema,
  sourceConnectionInputSchema,
} from "@/lib/portfolio-setup/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

import type { PrototypeState, Write } from "./prototype-store";

// The prototype's accounts and portfolios, written as the real actions write
// them: parsed with the same schemas and refused by the same guards, with
// every account the user's own.

const portfolioName = nameInputSchema(NAME_LIMITS.portfolios.name);
const accountInput = sourceConnectionInputSchema(
  NAME_LIMITS.source_connections.institution,
);

const refused = (
  state: PrototypeState,
  code: Extract<WriteResult, { ok: false }>["code"],
): Write<WriteResult> => ({ state, result: { ok: false, code } });
const done = (state: PrototypeState, id: string): Write<WriteResult> => ({
  state,
  result: { ok: true, id },
});

const fold = (name: string) => name.trim().toLocaleLowerCase("es-AR");

const holdsAny = (
  state: PrototypeState,
  key: "accountId" | "portfolioId",
  id: string,
) => state.holdings.some((each) => !each.closed && each[key] === id);

// --- Portfolios -------------------------------------------------------------

function takenName(state: PrototypeState, name: string, except?: string) {
  return [...state.portfolios, ...state.archivedPortfolios].some(
    (each) => each.id !== except && fold(each.name) === fold(name),
  );
}

export function createPortfolio(
  state: PrototypeState,
  input: unknown,
  id: string,
): Write<WriteResult> {
  const parsed = portfolioName.safeParse(input);
  if (!parsed.success) return refused(state, "invalid");
  if (takenName(state, parsed.data.name)) return refused(state, "duplicate");
  return done(
    {
      ...state,
      portfolios: [{ id, name: parsed.data.name }, ...state.portfolios],
    },
    id,
  );
}

// A new name shows on every account that defaults to it.
const renamed = (state: PrototypeState, row: PortfolioRow): PrototypeState => ({
  ...state,
  accounts: state.accounts.map((each) =>
    each.portfolio.id === row.id
      ? { ...each, portfolio: { ...each.portfolio, name: row.name } }
      : each,
  ),
});

export function renamePortfolio(
  state: PrototypeState,
  rawId: unknown,
  input: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = portfolioName.safeParse(input);
  if (!id.success || !parsed.success) return refused(state, "invalid");
  if (!state.portfolios.some((each) => each.id === id.data)) {
    return refused(state, "not_found");
  }
  if (takenName(state, parsed.data.name, id.data)) {
    return refused(state, "duplicate");
  }
  const row = { id: id.data, name: parsed.data.name };
  return done(
    renamed(
      {
        ...state,
        portfolios: state.portfolios.map((each) =>
          each.id === row.id ? row : each,
        ),
      },
      row,
    ),
    row.id,
  );
}

export function archivePortfolio(
  state: PrototypeState,
  rawId: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refused(state, "invalid");
  const row = state.portfolios.find((each) => each.id === id.data);
  if (!row) return refused(state, "not_found");
  if (state.portfolios.length === 1) {
    return refused(state, "last_active_portfolio");
  }
  if (state.accounts.some((each) => each.portfolio.id === row.id)) {
    return refused(state, "portfolio_in_use");
  }
  if (holdsAny(state, "portfolioId", row.id)) {
    return refused(state, "portfolio_has_holdings");
  }
  return done(
    {
      ...state,
      portfolios: state.portfolios.filter((each) => each.id !== row.id),
      archivedPortfolios: [row, ...state.archivedPortfolios],
    },
    row.id,
  );
}

export function restorePortfolio(
  state: PrototypeState,
  rawId: unknown,
  input?: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refused(state, "invalid");
  const row = state.archivedPortfolios.find((each) => each.id === id.data);
  if (!row) return refused(state, "not_found");
  let name = row.name;
  if (input !== undefined) {
    const parsed = portfolioName.safeParse(input);
    if (!parsed.success) return refused(state, "invalid");
    name = parsed.data.name;
  }
  if (takenName(state, name, row.id)) return refused(state, "duplicate");
  const restored = { id: row.id, name };
  return done(
    renamed(
      {
        ...state,
        portfolios: [restored, ...state.portfolios],
        archivedPortfolios: state.archivedPortfolios.filter(
          (each) => each.id !== row.id,
        ),
      },
      restored,
    ),
    row.id,
  );
}

// --- Accounts ---------------------------------------------------------------

function accountRow(
  state: PrototypeState,
  id: string,
  input: unknown,
): SourceConnectionRow | "invalid" | "portfolio_archived" {
  const parsed = accountInput.safeParse(input);
  if (!parsed.success) return "invalid";
  const portfolio = state.portfolios.find(
    (each) => each.id === parsed.data.defaultPortfolioId,
  );
  if (!portfolio) return "portfolio_archived";
  return {
    id,
    institution: parsed.data.institution,
    includeInTaxReport: parsed.data.includeInTaxReport,
    holder: null,
    portfolio: { ...portfolio, archived: false },
  };
}

export function createAccount(
  state: PrototypeState,
  input: unknown,
  id: string,
): Write<WriteResult> {
  const row = accountRow(state, id, input);
  if (typeof row === "string") return refused(state, row);
  return done({ ...state, accounts: [row, ...state.accounts] }, id);
}

export function updateAccount(
  state: PrototypeState,
  rawId: unknown,
  input: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refused(state, "invalid");
  if (!state.accounts.some((each) => each.id === id.data)) {
    return refused(state, "not_found");
  }
  const row = accountRow(state, id.data, input);
  if (typeof row === "string") return refused(state, row);
  return done(
    {
      ...state,
      accounts: state.accounts.map((each) => (each.id === row.id ? row : each)),
    },
    row.id,
  );
}

export function archiveAccount(
  state: PrototypeState,
  rawId: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refused(state, "invalid");
  const row = state.accounts.find((each) => each.id === id.data);
  if (!row) return refused(state, "not_found");
  if (holdsAny(state, "accountId", row.id)) {
    return refused(state, "source_connection_has_holdings");
  }
  return done(
    {
      ...state,
      accounts: state.accounts.filter((each) => each.id !== row.id),
      archivedAccounts: [row, ...state.archivedAccounts],
    },
    row.id,
  );
}

export function restoreAccount(
  state: PrototypeState,
  rawId: unknown,
  input: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refused(state, "invalid");
  if (!state.archivedAccounts.some((each) => each.id === id.data)) {
    return refused(state, "not_found");
  }
  const row = accountRow(state, id.data, input);
  if (typeof row === "string") return refused(state, row);
  return done(
    {
      ...state,
      accounts: [row, ...state.accounts],
      archivedAccounts: state.archivedAccounts.filter(
        (each) => each.id !== row.id,
      ),
    },
    row.id,
  );
}
