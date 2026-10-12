const getSessionClaims = jest.fn();
const read = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: () => getSessionClaims(),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => "12345678-aaaa-4bbb-8ccc-dddddddddddd",
}));
jest.mock("@/lib/portfolio-setup/read", () => ({
  readSourceConnections: () => read("accounts"),
  readPortfolios: () => read("portfolios"),
}));
jest.mock("./actions", () =>
  Object.fromEntries(
    [
      "archivePortfolio",
      "archiveSourceConnection",
      "createPortfolio",
      "createSourceConnection",
      "renamePortfolio",
      "restorePortfolio",
      "restoreSourceConnection",
      "updateSourceConnection",
    ].map((name) => [name, jest.fn()]),
  ),
);
jest.mock("@/components/portfolio-setup/accounts-setup", () => ({
  AccountsSetup: () => null,
}));
jest.mock("@/components/prototype/prototype-accounts", () => ({
  PrototypeAccounts: () => null,
}));

import type * as React from "react";

import { AccountsSetup } from "@/components/portfolio-setup/accounts-setup";
import { PrototypeAccounts } from "@/components/prototype/prototype-accounts";

import * as actions from "./actions";
import AccountsPage from "./page";

const saved = process.env.VERCEL_ENV;
afterEach(() => {
  jest.clearAllMocks();
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

type Props = React.ComponentProps<typeof AccountsSetup>;

it("wires every write to its server action in production", async () => {
  process.env.VERCEL_ENV = "production";
  getSessionClaims.mockResolvedValue({ sub: "u1" });
  read.mockImplementation(async (list: string) => ({ list }));
  const page = (await AccountsPage({
    searchParams: Promise.resolve({}),
  })) as React.ReactElement<{ children: React.ReactElement<Props>[] }>;
  const setup = page.props.children[1]!;
  expect(setup.type).toBe(AccountsSetup);
  expect(setup.props.sourceConnections).toEqual({ list: "accounts" });
  expect(setup.props.portfolios).toEqual({ list: "portfolios" });
  expect(setup.props.actions).toEqual({
    sourceConnections: {
      create: actions.createSourceConnection,
      update: actions.updateSourceConnection,
      archive: actions.archiveSourceConnection,
      restore: actions.restoreSourceConnection,
    },
    portfolios: {
      create: actions.createPortfolio,
      rename: actions.renamePortfolio,
      archive: actions.archivePortfolio,
      restore: actions.restorePortfolio,
    },
  });
});

it("shows the made-up accounts elsewhere, reading nothing", async () => {
  process.env.VERCEL_ENV = "preview";
  const page = (await AccountsPage({
    searchParams: Promise.resolve({}),
  })) as React.ReactElement<{ children: React.ReactElement[] }>;
  expect(page.props.children[1]!.type).toBe(PrototypeAccounts);
  expect(getSessionClaims).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
