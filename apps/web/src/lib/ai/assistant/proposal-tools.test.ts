jest.mock("server-only", () => ({}), { virtual: true });

import { proposalTools } from "./proposal-tools";

const NEXO = {
  id: "6f1c1a52-7c1a-4b1e-9a3e-1d2c3b4a5f60",
  institution: "Nexo",
  default_portfolio_id: "b1000000-0000-4000-8000-0000000000b1",
};
const PROPERTIES = {
  id: "a1000000-0000-4000-8000-0000000000a1",
  institution: "Inmuebles",
  default_portfolio_id: "b1000000-0000-4000-8000-0000000000b2",
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

describe("proposeDebt", () => {
  const line = {
    kind: "usd_debt",
    label: "Línea Nexo",
    lender: "Nexo",
    currency: "USD",
    instrumentSymbol: null,
    balance: "58501.09",
    principal: null,
    accruedInterest: null,
    annualRatePercent: "12.9",
    accrues: true,
    openedOn: "2026-10-20",
    installment: null,
    installmentsLeft: null,
    nextDueOn: null,
    maturesOn: null,
  };
  const propose = (args: object) =>
    run(tools().proposeDebt, { ...line, ...args }) as Promise<{
      proposal: { lines: string[] };
      input: { principal?: string | null };
    }>;

  it("keeps the printed capital and shows the interest it leaves", async () => {
    const output = await propose({
      principal: "54719.05",
      accruedInterest: "9999",
    });
    expect(output.input.principal).toBe("54719.05");
    expect(output.proposal.lines).toContain(
      "Capital: US$ 54.719,05 · Intereses: US$ 3.782,04",
    );
  });

  it("derives the capital from the printed interest", async () => {
    const output = await propose({ accruedInterest: "3782.04" });
    expect(output.input.principal).toBe("54719.05");
  });

  it("leaves the capital out without either figure or when the interest covers the balance", async () => {
    expect((await propose({})).input.principal).toBeNull();
    expect(
      (await propose({ accruedInterest: "58501.09" })).input.principal,
    ).toBeNull();
  });
});

describe("proposeRealEstate", () => {
  const property = {
    account: "Nexo",
    label: "Cochera Palermo",
    amount: "25000",
    currency: "USD",
    valuedOn: "2026-10-01",
    cost: null,
  };

  it("proposes a property in the named account", async () => {
    expect(await run(tools().proposeRealEstate, property)).toEqual({
      proposal: {
        title: "Cochera Palermo",
        lines: [
          "Inmueble en Nexo",
          expect.stringMatching(/^Valor: US\$\s?25\.000(,00)? al /),
        ],
      },
      input: expect.objectContaining({
        asset_class: "real_estate",
        source_connection_id: NEXO.id,
        portfolio_id: NEXO.default_portfolio_id,
        amount: "25000",
        currency: "USD",
        valued_on: "2026-10-01",
        label: "Cochera Palermo",
        cost: null,
      }),
    });
  });

  it("carries what a financed property cost", async () => {
    const output = await run(tools().proposeRealEstate, {
      ...property,
      amount: "34000",
      cost: "40800",
    });
    expect(output).toMatchObject({
      proposal: {
        lines: [
          "Inmueble en Nexo",
          expect.any(String),
          expect.stringMatching(/^Costo: US\$\s?40\.800(,00)?$/),
        ],
      },
      input: { amount: "34000", cost: "40800" },
    });
  });

  it("falls back to the Inmuebles account, valued today", async () => {
    const output = await run(tools([NEXO, PROPERTIES]).proposeRealEstate, {
      ...property,
      account: null,
      valuedOn: null,
    });
    expect(output).toMatchObject({
      proposal: { lines: ["Inmueble en Inmuebles", expect.any(String)] },
      input: {
        source_connection_id: PROPERTIES.id,
        portfolio_id: PROPERTIES.default_portfolio_id,
        valued_on: "2026-10-22",
      },
    });
  });

  it("asks to propose the Inmuebles account when there is none", async () => {
    expect(
      await run(tools().proposeRealEstate, { ...property, account: "Casa" }),
    ).toEqual({ error: expect.stringContaining("proposeAccount") });
  });

  it("refuses an amount that is not a value", async () => {
    expect(
      await run(tools().proposeRealEstate, { ...property, amount: "0" }),
    ).toEqual({ error: expect.stringContaining("amount") });
  });
});
