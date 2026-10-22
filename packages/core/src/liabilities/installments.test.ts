import {
  installmentPlan,
  installmentSeries,
  installmentsInputSchema,
} from "./installments";

const garage = [
  { due_on: "2026-10-31", amount: "3160" },
  { due_on: "2026-11-30", amount: "8160" },
  ...installmentSeries("2027-05-06", 6, 6, "4080"),
];

describe("installmentSeries", () => {
  it("steps by months from the start day", () => {
    expect(installmentSeries("2027-05-06", 6, 6, "4080")).toEqual(
      [
        "2027-05-06",
        "2027-11-06",
        "2028-05-06",
        "2028-11-06",
        "2029-05-06",
        "2029-11-06",
      ].map((due_on) => ({ due_on, amount: "4080" })),
    );
  });

  it("keeps to the month's last day when it is shorter", () => {
    expect(
      installmentSeries("2026-01-31", 3, 1, "1").map((i) => i.due_on),
    ).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});

describe("installmentPlan", () => {
  it("leaves the whole garage plan pending before any payment", () => {
    const plan = installmentPlan(garage, []);
    expect(plan.installments.every((i) => i.status === "pending")).toBe(true);
    expect(plan.next).toMatchObject({ due_on: "2026-10-31", owed: "3160" });
  });

  it("covers installments in date order and marks the partial one", () => {
    const plan = installmentPlan(garage, [
      { amount: "3160" },
      { amount: "5000" },
    ]);
    expect(plan.installments.slice(0, 3).map((i) => i.status)).toEqual([
      "paid",
      "partial",
      "pending",
    ]);
    expect(plan.next).toMatchObject({ due_on: "2026-11-30", owed: "3160" });
  });

  it("orders by date whatever order the rows come in", () => {
    const plan = installmentPlan([...garage].reverse(), [{ amount: "3160" }]);
    expect(plan.installments[0]).toMatchObject({
      due_on: "2026-10-31",
      status: "paid",
      owed: "0",
    });
  });

  it("has no next installment once everything is paid", () => {
    const plan = installmentPlan(garage, [{ amount: "40000" }]);
    expect(plan.next).toBeNull();
  });

  it("refuses a plan over the cap or with a zero amount", () => {
    expect(
      installmentsInputSchema.safeParse(
        installmentSeries("2026-01-01", 601, 1, "1"),
      ).success,
    ).toBe(false);
    expect(
      installmentsInputSchema.safeParse([{ due_on: "2026-01-01", amount: "0" }])
        .success,
    ).toBe(false);
  });
});
