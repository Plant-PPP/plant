jest.mock("server-only", () => ({}), { virtual: true });

import { proposalTools } from "./proposal-tools";

const NEXO = {
  id: "6f1c1a52-7c1a-4b1e-9a3e-1d2c3b4a5f60",
  institution: "Nexo",
};

const tools = (accounts = [NEXO]) =>
  proposalTools({
    today: "2026-10-22",
    accounts: async () => accounts,
    debts: async () => [],
  });

const run = (tool: { execute?: unknown }, args: unknown) =>
  (tool.execute as (args: unknown, options: unknown) => Promise<unknown>)(
    args,
    { toolCallId: "t1", messages: [] },
  );

const row = (symbol: string, quantity: string, cash = false) => ({
  symbol,
  quantity,
  currency: "USD",
  cash,
  price: null,
  cost: null,
});

describe("proposeHoldings", () => {
  it("proposes an exchange's balances in its account, fiat as cash and stablecoins as holdings", async () => {
    const output = await run(tools().proposeHoldings, {
      account: "nexo",
      rows: [
        row("eth", "1.2"),
        row("USDT", "1000"),
        row("USD", "500", true),
        { ...row("EUR", "20", true), currency: "EUR" },
      ],
    });
    expect(output).toEqual({
      proposal: {
        title: "Tenencias en Nexo",
        lines: ["1,2 ETH", "1.000 USDT", "Saldo: US$ 500,00", "Saldo: € 20,00"],
      },
      input: {
        accountId: NEXO.id,
        rows: [
          expect.objectContaining({ symbol: "ETH", asset_class: "instrument" }),
          expect.objectContaining({
            symbol: "USDT",
            asset_class: "instrument",
          }),
          expect.objectContaining({ symbol: "USD", asset_class: "cash" }),
          expect.objectContaining({ symbol: "EUR", asset_class: "cash" }),
        ],
      },
    });
  });

  it("asks for the account first when the user has none of that name", async () => {
    expect(
      await run(tools([]).proposeHoldings, {
        account: "Nexo",
        rows: [row("BTC", "0.05")],
      }),
    ).toEqual({ error: expect.stringContaining("proposeAccount") });
  });

  it("asks which account when two share the name", async () => {
    expect(
      await run(tools([NEXO, { ...NEXO, id: "other" }]).proposeHoldings, {
        account: "Nexo",
        rows: [row("BTC", "0.05")],
      }),
    ).toEqual({ error: expect.stringContaining("askUser") });
  });

  it("shows eight rows on the card and counts the rest", async () => {
    const output = (await run(tools().proposeHoldings, {
      account: "Nexo",
      rows: Array.from({ length: 10 }, (_, index) => row(`T${index}`, "1")),
    })) as { proposal: { lines: string[] } };
    expect(output.proposal.lines).toHaveLength(9);
    expect(output.proposal.lines.at(-1)).toBe("y 2 más");
  });
});

describe("proposeOperations", () => {
  it("proposes a purchase and a deposit of units in the account", async () => {
    const output = await run(tools().proposeOperations, {
      account: "Nexo",
      rows: [
        {
          date: "2026-10-21",
          kind: "purchase",
          symbol: "btc",
          quantity: "0.1",
          price: "84000",
          amount: null,
          charges: null,
          currency: "USD",
        },
        {
          date: null,
          kind: "adjustment",
          symbol: "USDT",
          quantity: "4000",
          price: null,
          amount: null,
          charges: null,
          currency: "USD",
        },
      ],
    });
    expect(output).toEqual({
      proposal: {
        title: "Operaciones en Nexo",
        lines: [
          "21/10/2026 · Compra 0,1 BTC a US$ 84.000,00",
          "Ajuste 4.000 USDT",
        ],
      },
      input: {
        accountId: NEXO.id,
        rows: [
          expect.objectContaining({ symbol: "BTC", kind: "purchase" }),
          expect.objectContaining({ symbol: "USDT", kind: "adjustment" }),
        ],
      },
    });
  });
});
