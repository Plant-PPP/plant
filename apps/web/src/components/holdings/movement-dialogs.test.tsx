jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { EMPTY_POSITION, holdingSchema } from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConfirmSpec } from "@/components/ui/confirm-dialog";
import type { MovementLine } from "@/lib/holdings/movements-input";
import type { HoldingRow } from "@/lib/holdings/read";

import { instrumentPreset, useMovementDialogs } from "./movement-dialogs";

const ETH = {
  symbol: "ETH",
  name: "Ethereum",
  type: "crypto" as const,
  currency: "USD" as const,
};

const ACCOUNT = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
  portfolio: { id: "p1", name: "Principal", archived: false },
};

const holding: HoldingRow = {
  id: "e1",
  holding: holdingSchema.parse({
    id: "e1",
    portfolio_id: "p2",
    asset_class: "instrument",
    instrument_symbol: "ETH",
    amount: "1.5",
    currency: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: "a1", institution: "IOL" },
  portfolio: { id: "p2", name: "Largo plazo" },
  instrumentType: "crypto",
};

const done = async () => ({ ok: true as const, id: "x" });

// Runs the hook in a server render and hands back what `use` reads from it.
function withDialogs<T>(
  use: (dialogs: ReturnType<typeof useMovementDialogs>) => T,
  confirm: (spec: ConfirmSpec) => void = jest.fn(),
): T {
  let out: { value: T } | null = null;
  function Harness() {
    const dialogs = useMovementDialogs({
      card: {
        focusHeading: jest.fn(),
        rowAction: jest.fn(),
        dialogAction: jest.fn(),
      },
      active: [holding],
      accounts: [ACCOUNT],
      portfolios: [{ id: "p1", name: "Principal" }],
      instruments: [ETH],
      today: "2026-10-12",
      names: new Map([["ETH", "Ethereum"]]),
      confirm,
      pending: false,
    });
    out = { value: use(dialogs) };
    return null;
  }
  renderToStaticMarkup(<Harness />);
  return out!.value;
}

it("starts a holding without movements on its amount as an opening balance", () => {
  const position = new Map([["e1", EMPTY_POSITION]]);
  const fresh = withDialogs((dialogs) =>
    dialogs.newOperationFields(holding, {}, new Map()),
  );
  expect(fresh.kind).toBe("opening_balance");
  expect(fresh.parts).toEqual([{ portfolioId: "p2", size: "1,5" }]);
  const held = withDialogs((dialogs) =>
    dialogs.newOperationFields(holding, {}, position),
  );
  expect(held.kind).toBe("purchase");
  expect(held.parts).toEqual([{ portfolioId: "p2", size: "" }]);
});

it("asks before deleting a movement, naming where it is", () => {
  const confirm = jest.fn<void, [ConfirmSpec]>();
  const line: MovementLine = {
    movement: {
      id: "m1",
      holding_id: "e1",
      kind: "sale",
      date: "2026-10-01",
      currency: "USD",
      quantity: "0.5",
      price: "2000",
      charges: [],
      reference: null,
      note: null,
      operation_id: "op1",
      entry_order: 1,
      rates: {
        mep: { sell: "1200", date: "2026-10-01" },
        ccl: { sell: "1250", date: "2026-10-01" },
        official: { sell: "1000", date: "2026-10-01" },
      },
    },
    amount: "1000",
    charges: null,
    operation: { accountId: "a1", instrument: "ETH", parts: [] },
  };
  withDialogs((dialogs) => {
    const remove = dialogs
      .movementLineActions(
        {
          input: { positions: new Map() },
          actions: { create: done, update: done, delete: done },
        },
        () => holding,
      )
      .find((action) => action.id === "delete")!;
    remove.onClick(line);
  }, confirm);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0]![0].title).toBe(
    "¿Borrar venta de 0,5 del 01/10/2026 en IOL · Largo plazo?",
  );
});

describe("instrumentPreset", () => {
  const IOL = { id: "a1", institution: "IOL" };
  const BINANCE = { id: "a2", institution: "Binance" };
  const PRINCIPAL = { id: "p1", name: "Principal" };
  const LARGO = { id: "p2", name: "Largo plazo" };

  it("starts in the one account and portfolio the instrument is held in", () => {
    expect(
      instrumentPreset("ETH", [
        { account: BINANCE, portfolio: LARGO },
        { account: BINANCE, portfolio: LARGO },
      ]),
    ).toEqual({ instrument: "ETH", accountId: "a2", portfolioId: "p2" });
  });

  it("leaves the account or portfolio open when it is held in several", () => {
    expect(
      instrumentPreset("ETH", [
        { account: IOL, portfolio: LARGO },
        { account: BINANCE, portfolio: LARGO },
      ]),
    ).toEqual({ instrument: "ETH", portfolioId: "p2" });
    expect(
      instrumentPreset("ETH", [
        { account: IOL, portfolio: PRINCIPAL },
        { account: IOL, portfolio: LARGO },
      ]),
    ).toEqual({ instrument: "ETH", accountId: "a1" });
    expect(instrumentPreset("ETH", [])).toEqual({ instrument: "ETH" });
  });
});
