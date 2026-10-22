jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import {
  type InstallmentPlan,
  installmentPlan,
  type Liability,
  type LiabilityOnDate,
} from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import { CALCULATING, NO_QUOTE } from "@/components/holdings/sum-text";
import { formatFraction } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";

import { type DebtActions, DebtsSetup } from "./debts-setup";

const done = async () => ({ ok: true as const, id: "x" });
const ACTIONS: DebtActions = { create: done, update: done, delete: done };

const debt = (fields: Partial<Liability>): Liability => ({
  id: "d1",
  kind: "usd_debt",
  label: "Préstamo",
  lender: null,
  currency: "USD",
  uva: false,
  instrument_symbol: null,
  balance: "1000",
  installment: "100",
  annual_rate: "0.1",
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: false,
  opened_on: "2026-01-01",
  anchored_on: "2026-01-01",
  ...fields,
});

const render = (
  active: Liability[],
  owed: Partial<Liability>[],
  complete = true,
  plans: Record<string, InstallmentPlan> = {},
) =>
  renderToStaticMarkup(
    <DebtsSetup
      debts={{
        active,
        activeTruncated: false,
        archived: [],
        archivedPage: null,
        archivedFirstHref: null,
        archivedNextHref: null,
      }}
      owed={active.map(
        (each, i) => ({ ...each, ...owed[i] }) as LiabilityOnDate,
      )}
      complete={complete}
      plans={plans}
      valued={{ total: "0", complete: true, items: [] }}
      unit="usd_mep"
      referenceUnit="usd_mep"
      params={{}}
      instruments={[]}
      actions={ACTIONS}
    />,
  );

const tile = (html: string, label: string) =>
  html.split(`>${label}</dt>`)[1]!.split("</dd>")[0];

it("shows each debt's balance and rate today", () => {
  const html = render([debt({})], [{ balance: "400", annual_rate: "0.2" }]);
  expect(html).toContain("US$ 400,00");
  expect(html).not.toContain("US$ 1.000,00");
  expect(html).toContain(formatFraction("0.2"));
  expect(html).not.toContain(formatFraction("0.1"));
});

it("leaves a paid-off debt out of what is owed", () => {
  const paid = debt({ id: "d1", label: "Pagada", next_due_on: "2026-11-01" });
  const open = debt({ id: "d2", label: "Abierta", next_due_on: "2026-12-01" });
  const html = render([paid, open], [{ balance: "0" }, {}]);
  expect(tile(html, "Deudas")).toMatch(/>1$/);
  expect(tile(html, "Con cuota")).toMatch(/>1$/);
  expect(tile(html, "Próximo vencimiento")).toContain(formatDate("2026-12-01"));
});

it("says when a balance could not be computed in full", () => {
  expect(render([debt({})], [{}], false)).toContain(
    "Algún saldo no se pudo calcular completo",
  );
});

it("shows a debt being written as calculating, not its opening figures", () => {
  const pending = { ...debt({ balance: "1000" }), unsaved: true } as Liability;
  const html = render([pending], [{}]);
  expect(html).toContain(CALCULATING);
  expect(html).not.toContain("US$ 1.000,00");
  expect(html).not.toContain(formatFraction("0.1"));
});

it("keeps counting an edited paid-off debt as paid off", () => {
  const editing = {
    ...debt({ next_due_on: "2026-11-01" }),
    unsaved: true,
  } as Liability;
  const html = render([editing], [{ balance: "0" }]);
  expect(tile(html, "Deudas")).toMatch(/>0$/);
  expect(tile(html, "Próximo vencimiento")).toContain("Ninguno");
});

it("gives both reasons a total is incomplete", () => {
  const html = renderToStaticMarkup(
    <DebtsSetup
      debts={{
        active: [debt({})],
        activeTruncated: false,
        archived: [],
        archivedPage: null,
        archivedFirstHref: null,
        archivedNextHref: null,
      }}
      owed={[debt({}) as LiabilityOnDate]}
      complete={false}
      valued={{ total: "0", complete: false, items: [] }}
      unit="usd_mep"
      referenceUnit="usd_mep"
      params={{}}
      instruments={[]}
      actions={ACTIONS}
    />,
  );
  expect(html).toContain("Alguna deuda no tiene cotización");
  expect(html).toContain("Algún saldo no se pudo calcular completo");
});

it("shows no total when no debt has a quote", () => {
  const html = render([debt({})], [{}]);
  expect(tile(html, "Total")).toContain(NO_QUOTE);
  expect(tile(html, "Total")).not.toContain("US$ 0,00");
});

it("shows a planned debt's next installment and due date", () => {
  const plan = installmentPlan(
    [
      { due_on: "2026-10-31", amount: "3160" },
      { due_on: "2026-11-30", amount: "8160" },
      { due_on: "2027-05-06", amount: "4080" },
    ],
    [{ amount: "3160" }],
  );
  const html = render(
    [debt({ installment: "999", next_due_on: "2026-10-01" })],
    [{}],
    true,
    { d1: plan },
  );
  expect(html).toContain("US$ 8.160,00");
  expect(html).toContain("Quedan 2");
  expect(html).toContain(formatDate("2026-11-30"));
  expect(html).not.toContain("US$ 999,00");
  expect(html).not.toContain(formatDate("2026-10-01"));
});
