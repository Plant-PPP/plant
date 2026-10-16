import {
  eventFields,
  eventInputValid,
  toCashInput,
  toEventInput,
} from "./debt-event-fields";

const TODAY = "2026-10-15";
const CASH = [
  {
    id: "h1",
    label: "Cocos · Principal",
    currency: "USD" as const,
    amount: "2500",
  },
];

it("sends each kind with only its own fields, in the stored scale", () => {
  const payment = {
    ...eventFields("payment", null, TODAY),
    amount: "1.500,5",
    settles: true,
  };
  expect(toEventInput(payment)).toEqual({
    kind: "payment",
    date: TODAY,
    amount: "1500.5",
    settles: true,
  });
  expect(
    toEventInput({ ...eventFields("rate_change", null, TODAY), rate: "15" }),
  ).toEqual({ kind: "rate_change", date: TODAY, annual_rate: "0.15" });
  expect(
    toEventInput({ ...eventFields("adjustment", null, TODAY), amount: "0" }),
  ).toEqual({ kind: "adjustment", date: TODAY, amount: "0" });
});

it("refuses an amount it cannot read", () => {
  expect(
    eventInputValid({ ...eventFields("payment", null, TODAY), amount: "abc" }),
  ).toBe(false);
  expect(
    eventInputValid({ ...eventFields("payment", null, TODAY), amount: "0" }),
  ).toBe(false);
});

it("names the cash a payment came from with its amount as read", () => {
  const fields = {
    ...eventFields("payment", null, TODAY),
    amount: "100",
    cashHoldingId: "h1",
    take: true,
  };
  expect(toCashInput(fields, CASH)).toEqual({
    holding_id: "h1",
    take: true,
    expected: "2500",
  });
  expect(toCashInput({ ...fields, cashHoldingId: "" }, CASH)).toBeNull();
  expect(toCashInput({ ...fields, kind: "adjustment" }, CASH)).toBeNull();
});

it("starts an edit from the event as stored", () => {
  expect(
    eventFields(
      "payment",
      {
        id: "e1",
        liability_id: "d1",
        created_at: "2026-10-01T00:00:00Z",
        kind: "payment",
        date: "2026-10-01",
        amount: "1000",
        annual_rate: null,
        cash_holding_id: "h1",
        takes_cash: true,
        settles: false,
      },
      TODAY,
    ),
  ).toMatchObject({ date: "2026-10-01", cashHoldingId: "h1", take: true });
});
