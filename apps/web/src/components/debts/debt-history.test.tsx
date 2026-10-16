jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import type { Liability, LiabilityEvent, QuoteSnapshot } from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import { formatFraction } from "@/lib/format/amount";

import { DebtHistory, editedDebt } from "./debt-history";
import { debtFields, toLiabilityInput } from "./debt-fields";

const done = async () => ({ ok: true as const, id: "x", cashRestored: true });
const ACTIONS = {
  events: { record: done, update: done, delete: done },
  debts: {
    update: async () => ({ ok: true as const, id: "d1" }),
    delete: async () => ({ ok: true as const, id: "d1" }),
  },
  collateral: async () => ({ ok: true as const, id: "d1" }),
};

const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-15",
  fx: { mep: { sell: "1000", date: "2026-10-15" } },
  prices: {},
};

const loan: Liability = {
  id: "d1",
  kind: "usd_debt",
  label: "Préstamo Nexo",
  lender: "Nexo",
  currency: "USD",
  uva: false,
  instrument_symbol: null,
  balance: "1000",
  installment: null,
  annual_rate: "0",
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: true,
  opened_on: "2026-01-01",
  anchored_on: "2026-01-01",
};

const event = (fields: Partial<LiabilityEvent>): LiabilityEvent =>
  ({
    id: "e1",
    liability_id: "d1",
    created_at: "2026-02-01T00:00:00Z",
    kind: "payment",
    date: "2026-02-01",
    amount: "400",
    annual_rate: null,
    cash_holding_id: null,
    takes_cash: false,
    settles: false,
    ...fields,
  }) as LiabilityEvent;

const render = (
  debt: Liability,
  events: LiabilityEvent[],
  pledged: { ids: string[]; value: string | null } = { ids: [], value: null },
) =>
  renderToStaticMarkup(
    <DebtHistory
      debt={debt}
      events={events}
      collateral={pledged.ids}
      complete
      today="2026-10-15"
      snapshot={SNAPSHOT}
      unit="usd_mep"
      referenceUnit="usd_mep"
      referenceDollar="mep"
      params={{}}
      instruments={[]}
      cash={[]}
      pledgeOptions={pledged.ids.map((id) => ({
        id,
        label: "BTC · Bitcoin",
        place: "Binance · Largo plazo",
        value: pledged.value,
      }))}
      actions={ACTIONS}
    />,
  );

it("shows the balance and rate today from the debt's events", () => {
  const html = render(loan, [
    event({}),
    event({
      id: "e2",
      kind: "rate_change",
      amount: null,
      annual_rate: "0.2",
      date: "2026-10-15",
      created_at: "2026-10-15T00:00:00Z",
    }),
  ]);
  expect(html).toContain("US$ 600,00");
  expect(html).toContain(formatFraction("0.2"));
  expect(html).toContain("Registrar pago");
  expect(html).toContain("Saldo inicial");
});

it("says a settled debt is paid off", () => {
  const html = render(loan, [event({ amount: "1000", settles: true })]);
  expect(html).toContain("Cancelada");
  expect(html).toContain("No debés nada");
});

it("shows what the collateral covers", () => {
  const html = render(loan, [], { ids: ["h1"], value: "2000" });
  expect(html).toContain("Garantía");
  expect(html).toContain(formatFraction("0.5"));
});

it("keeps a card to its statements, with no history", () => {
  const html = render({ ...loan, kind: "credit_card", accrues: false }, []);
  expect(html).not.toContain("Registrar pago");
  expect(html).toContain("Las tarjetas siguen su resumen");
});

it("keeps the anchor of a debt being edited, so its figures still compute", () => {
  const edited = editedDebt(loan, toLiabilityInput(debtFields(loan)));
  expect(edited.anchored_on).toBe("2026-01-01");
  expect(() => render(edited, [event({})])).not.toThrow();
  const moved = editedDebt(
    loan,
    toLiabilityInput({ ...debtFields(loan), openedOn: "2026-01-10" }),
  );
  expect(moved.anchored_on).toBe("2026-01-10");
});

it("lists a pledge on a holding no longer held, with no value", () => {
  const html = renderToStaticMarkup(
    <DebtHistory
      debt={loan}
      events={[]}
      collateral={["gone"]}
      complete
      today="2026-10-15"
      snapshot={SNAPSHOT}
      unit="usd_mep"
      referenceUnit="usd_mep"
      referenceDollar="mep"
      params={{}}
      instruments={[]}
      cash={[]}
      pledgeOptions={[]}
      actions={ACTIONS}
    />,
  );
  expect(html).toContain("Garantía");
  expect(html).toContain("Sin cotización de algún activo");
});
