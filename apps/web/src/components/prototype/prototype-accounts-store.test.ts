import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  accountsDeletingUploads,
  archiveAccount,
  archivePortfolio,
  createAccount,
  createPortfolio,
  deletableRows,
  deleteAccount,
  deletePortfolio,
  deletesUploads,
  renamePortfolio,
  restorePortfolio,
} from "./prototype-accounts-store";
import { addImport, finishReading } from "./prototype-imports-store";
import { deleteHolding, holdingsView, initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const NEW_ID = "e3000000-0000-4000-8000-000000000001";
const PRINCIPAL = state.portfolios[0]!.id;

it("creates an account from its parsed fields", () => {
  const created = createAccount(
    state,
    {
      institution: "Lemon",
      includeInTaxReport: true,
      defaultPortfolioId: PRINCIPAL,
    },
    NEW_ID,
  );
  expect(created.result).toEqual({ ok: true, id: NEW_ID });
  expect(created.state.accounts[0]).toEqual({
    id: NEW_ID,
    institution: "Lemon",
    includeInTaxReport: true,
    portfolio: { ...state.portfolios[0]!, archived: false },
  });
});

it("shows a renamed portfolio on its holdings and accounts", () => {
  const { state: next } = renamePortfolio(state, PRINCIPAL, {
    name: "Día a día",
  });
  expect(
    holdingsView(next).active.some((row) => row.portfolio.name === "Día a día"),
  ).toBe(true);
  expect(next.accounts.some((row) => row.portfolio.name === "Día a día")).toBe(
    true,
  );
});

it("refuses a duplicate name and archiving what holdings or accounts use", () => {
  expect(createPortfolio(state, { name: "principal" }, NEW_ID).result).toEqual({
    ok: false,
    code: "duplicate",
  });
  expect(archivePortfolio(state, PRINCIPAL).result).toEqual({
    ok: false,
    code: "portfolio_in_use",
  });
  expect(archiveAccount(state, state.accounts[0]!.id).result).toEqual({
    ok: false,
    code: "source_connection_has_holdings",
  });
});

it("archives an unused portfolio and restores it", () => {
  const created = createPortfolio(state, { name: "Viajes" }, NEW_ID).state;
  const archived = archivePortfolio(created, NEW_ID);
  expect(archived.result).toEqual({ ok: true, id: NEW_ID });
  expect(archived.state.archivedPortfolios[0]!.id).toBe(NEW_ID);
  const restored = restorePortfolio(archived.state, NEW_ID);
  expect(restored.state.portfolios.some((row) => row.id === NEW_ID)).toBe(true);
});

it("deletes only what nothing uses", () => {
  expect(deleteAccount(state, state.accounts[0]!.id).result).toEqual({
    ok: false,
    code: "source_connection_has_holdings",
  });
  expect(deletePortfolio(state, PRINCIPAL).result).toEqual({
    ok: false,
    code: "portfolio_in_use",
  });
  const created = createPortfolio(state, { name: "Viajes" }, NEW_ID).state;
  const deleted = deletePortfolio(created, NEW_ID);
  expect(deleted.result).toEqual({ ok: true, id: NEW_ID });
  expect(deleted.state.portfolios.some((row) => row.id === NEW_ID)).toBe(false);
});

describe("deletesUploads", () => {
  const LEMON = "e3000000-0000-4000-8000-000000000002";
  const UPLOAD = "e3000000-0000-4000-8000-000000000003";
  const lemon = createAccount(
    state,
    {
      institution: "Lemon",
      includeInTaxReport: true,
      defaultPortfolioId: PRINCIPAL,
    },
    LEMON,
  ).state;
  const upload = (s: typeof state, accountId: string) =>
    addImport(s, { id: UPLOAD, fileName: "resumen.pdf", accountId }).state;

  it("lists the accounts, archived ones too, whose delete takes an upload", () => {
    expect(accountsDeletingUploads(lemon)).toEqual([]);
    expect(accountsDeletingUploads(upload(lemon, LEMON))).toEqual([LEMON]);
    const archived = archiveAccount(upload(lemon, LEMON), LEMON).state;
    expect(archived.archivedAccounts.some((row) => row.id === LEMON)).toBe(
      true,
    );
    expect(accountsDeletingUploads(archived)).toEqual([LEMON]);
  });

  it("is false for an account with no uploads", () => {
    expect(deletesUploads(lemon, LEMON)).toBe(false);
  });

  it("is true when the delete goes through and takes an upload", () => {
    expect(deletesUploads(upload(lemon, LEMON), LEMON)).toBe(true);
  });

  it("is false when another account has the upload", () => {
    const other = state.accounts[0]!.id;
    expect(deletesUploads(upload(lemon, other), LEMON)).toBe(false);
  });

  it("is false when the delete is refused", () => {
    const account = state.accounts[0]!.id;
    expect(deletesUploads(upload(state, account), account)).toBe(false);
  });

  it("is true for an upload read for review once the account holds nothing", () => {
    const account = state.accounts[0]!.id;
    const read = finishReading(upload(state, account), UPLOAD);
    expect(read.imports[0]!.status).toBe("ready");
    const emptied = read.holdings
      .filter((each) => each.accountId === account)
      .reduce((s, each) => deleteHolding(s, each.holding.id).state, read);
    expect(deletesUploads(emptied, account)).toBe(true);
    const deleted = deleteAccount(emptied, account);
    expect(deleted.result).toEqual({ ok: true, id: account });
    expect(deleted.state.imports).toEqual([]);
  });
});

describe("deletableRows", () => {
  const LEMON = "e3000000-0000-4000-8000-000000000004";
  const UPLOAD = "e3000000-0000-4000-8000-000000000005";
  const withLemon = createAccount(
    createPortfolio(state, { name: "Vacía" }, NEW_ID).state,
    {
      institution: "Lemon",
      includeInTaxReport: true,
      defaultPortfolioId: PRINCIPAL,
    },
    LEMON,
  ).state;

  it("offers exactly the rows whose delete goes through", () => {
    const rows = deletableRows(withLemon);
    expect(rows.sourceConnections).toContain(LEMON);
    expect(rows.portfolios).toContain(NEW_ID);
    expect(rows.portfolios).not.toContain(PRINCIPAL);
    for (const id of rows.portfolios) {
      expect(deletePortfolio(withLemon, id).result.ok).toBe(true);
    }
    for (const id of rows.sourceConnections) {
      expect(deleteAccount(withLemon, id).result.ok).toBe(true);
    }
    for (const row of withLemon.accounts) {
      if (!rows.sourceConnections.includes(row.id)) {
        expect(deleteAccount(withLemon, row.id).result.ok).toBe(false);
      }
    }
    expect(rows.deletesUploads).toEqual([]);
  });

  it("marks the deletable accounts that take uploads", () => {
    const uploaded = addImport(withLemon, {
      id: UPLOAD,
      fileName: "resumen.pdf",
      accountId: LEMON,
    }).state;
    expect(deletableRows(uploaded).deletesUploads).toEqual([LEMON]);
  });
});
