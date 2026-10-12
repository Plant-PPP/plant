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

import {
  type PrototypeState,
  refusedWrite,
  type Write,
} from "./prototype-store";

// The prototype's accounts and portfolios, written as the real actions write
// them: parsed with the same schemas and refused by the same guards, with
// every account the user's own.

const portfolioName = nameInputSchema(NAME_LIMITS.portfolios.name);
const accountInput = sourceConnectionInputSchema(
  NAME_LIMITS.source_connections.institution,
);

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
  if (!parsed.success) return refusedWrite(state, "invalid");
  if (takenName(state, parsed.data.name))
    return refusedWrite(state, "duplicate");
  return done(
    {
      ...state,
      portfolios: [{ id, name: parsed.data.name }, ...state.portfolios],
    },
    id,
  );
}

// A new name shows on every account that defaults to it.
const renamed = (state: PrototypeState, row: PortfolioRow): PrototypeState => {
  const withName = (each: SourceConnectionRow) =>
    each.portfolio.id === row.id
      ? { ...each, portfolio: { ...each.portfolio, name: row.name } }
      : each;
  return {
    ...state,
    accounts: state.accounts.map(withName),
    archivedAccounts: state.archivedAccounts.map(withName),
  };
};

export function renamePortfolio(
  state: PrototypeState,
  rawId: unknown,
  input: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  const parsed = portfolioName.safeParse(input);
  if (!id.success || !parsed.success) return refusedWrite(state, "invalid");
  if (!state.portfolios.some((each) => each.id === id.data)) {
    return refusedWrite(state, "not_found");
  }
  if (takenName(state, parsed.data.name, id.data)) {
    return refusedWrite(state, "duplicate");
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
  if (!id.success) return refusedWrite(state, "invalid");
  const row = state.portfolios.find((each) => each.id === id.data);
  if (!row) return refusedWrite(state, "not_found");
  if (state.portfolios.length === 1) {
    return refusedWrite(state, "last_active_portfolio");
  }
  if (state.accounts.some((each) => each.portfolio.id === row.id)) {
    return refusedWrite(state, "portfolio_in_use");
  }
  if (holdsAny(state, "portfolioId", row.id)) {
    return refusedWrite(state, "portfolio_has_holdings");
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
  if (!id.success) return refusedWrite(state, "invalid");
  const row = state.archivedPortfolios.find((each) => each.id === id.data);
  if (!row) return refusedWrite(state, "not_found");
  let name = row.name;
  if (input !== undefined) {
    const parsed = portfolioName.safeParse(input);
    if (!parsed.success) return refusedWrite(state, "invalid");
    name = parsed.data.name;
  }
  if (takenName(state, name, row.id)) return refusedWrite(state, "duplicate");
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
  if (typeof row === "string") return refusedWrite(state, row);
  return done({ ...state, accounts: [row, ...state.accounts] }, id);
}

export function updateAccount(
  state: PrototypeState,
  rawId: unknown,
  input: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refusedWrite(state, "invalid");
  if (!state.accounts.some((each) => each.id === id.data)) {
    return refusedWrite(state, "not_found");
  }
  const row = accountRow(state, id.data, input);
  if (typeof row === "string") return refusedWrite(state, row);
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
  if (!id.success) return refusedWrite(state, "invalid");
  const row = state.accounts.find((each) => each.id === id.data);
  if (!row) return refusedWrite(state, "not_found");
  if (holdsAny(state, "accountId", row.id)) {
    return refusedWrite(state, "source_connection_has_holdings");
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
  if (!id.success) return refusedWrite(state, "invalid");
  if (!state.archivedAccounts.some((each) => each.id === id.data)) {
    return refusedWrite(state, "not_found");
  }
  const row = accountRow(state, id.data, input);
  if (typeof row === "string") return refusedWrite(state, row);
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

// --- Deletes ----------------------------------------------------------------

const holdsEver = (
  state: PrototypeState,
  key: "accountId" | "portfolioId",
  id: string,
) => state.holdings.some((each) => each[key] === id);

// An account that never held anything, active or archived.
export function deleteAccount(
  state: PrototypeState,
  rawId: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refusedWrite(state, "invalid");
  const known = [...state.accounts, ...state.archivedAccounts].some(
    (each) => each.id === id.data,
  );
  if (!known) return refusedWrite(state, "not_found");
  if (holdsEver(state, "accountId", id.data)) {
    return refusedWrite(state, "source_connection_has_holdings");
  }
  return done(
    {
      ...state,
      accounts: state.accounts.filter((each) => each.id !== id.data),
      archivedAccounts: state.archivedAccounts.filter(
        (each) => each.id !== id.data,
      ),
      // Its imports go with it, though they still count against the month's
      // uploads.
      imports: state.imports.filter((each) => each.accountId !== id.data),
    },
    id.data,
  );
}

// Whether deleting an account goes through and takes uploads with it.
export const deletesUploads = (state: PrototypeState, accountId: string) =>
  deleteAccount(state, accountId).state.imports.length < state.imports.length;

// A portfolio no account defaults to and that never held anything, active or
// archived; the last active one stays.
export function deletePortfolio(
  state: PrototypeState,
  rawId: unknown,
): Write<WriteResult> {
  const id = idSchema.safeParse(rawId);
  if (!id.success) return refusedWrite(state, "invalid");
  const active = state.portfolios.some((each) => each.id === id.data);
  if (
    !active &&
    !state.archivedPortfolios.some((each) => each.id === id.data)
  ) {
    return refusedWrite(state, "not_found");
  }
  if (active && state.portfolios.length === 1) {
    return refusedWrite(state, "last_active_portfolio");
  }
  if (
    [...state.accounts, ...state.archivedAccounts].some(
      (each) => each.portfolio.id === id.data,
    )
  ) {
    return refusedWrite(state, "portfolio_in_use");
  }
  if (holdsEver(state, "portfolioId", id.data)) {
    return refusedWrite(state, "portfolio_has_holdings");
  }
  return done(
    {
      ...state,
      portfolios: state.portfolios.filter((each) => each.id !== id.data),
      archivedPortfolios: state.archivedPortfolios.filter(
        (each) => each.id !== id.data,
      ),
    },
    id.data,
  );
}
