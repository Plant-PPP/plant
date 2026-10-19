import { exactOf, stored } from "@plant/shared";

import { admitCashHistory, type CashMovement, cashHeldAt } from "./cash";

const RATES = {
  mep: { sell: "1000", date: "2026-09-01" },
  ccl: { sell: "1000", date: "2026-09-01" },
  official: { sell: "1000", date: "2026-09-01" },
};

const movement = (
  kind: CashMovement["kind"],
  date: string,
  amount: string,
): CashMovement => ({
  id: `${kind}-${date}-${amount}`,
  holding_id: "cash",
  operation_id: kind === "settlement" ? "operation" : null,
  kind,
  date,
  amount,
  reference: null,
  note: null,
  rates: RATES,
});

const HISTORY = [
  movement("opening_balance", "2026-09-01", "100"),
  movement("deposit", "2026-09-01", "50"),
  movement("settlement", "2026-09-10", "-120"),
  movement("withdrawal", "2026-09-20", "-30"),
];

describe("cashHeldAt", () => {
  const at = (date: string) => stored(cashHeldAt(HISTORY, exactOf("0"), date));

  test("takes off today's amount what came after the day", () => {
    expect(at("2026-09-30")).toBe("0");
    expect(at("2026-09-15")).toBe("30");
    expect(at("2026-09-01")).toBe("150");
  });

  test("holds the opening balance before it, with no jump", () => {
    expect(at("2026-08-31")).toBe("100");
    expect(at("2026-01-01")).toBe("100");
  });
});

describe("admitCashHistory", () => {
  test("wants one opening balance first and nothing after today", () => {
    expect(admitCashHistory(HISTORY, "2026-10-01")).toBeNull();
    expect(admitCashHistory([], "2026-10-01")).toBeNull();
    expect(admitCashHistory(HISTORY.slice(1), "2026-10-01")).toBe(
      "needs_opening",
    );
    expect(
      admitCashHistory(
        [...HISTORY, movement("deposit", "2026-08-01", "1")],
        "2026-10-01",
      ),
    ).toBe("before_opening");
    expect(admitCashHistory(HISTORY, "2026-09-15")).toBe("future");
  });
});
