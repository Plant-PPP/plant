import { splitCharges } from "./operation";

it("splits each charge by quantity, the last part taking the rounding", () => {
  const charges = [
    { kind: "commission" as const, label: null, amount: "10" },
    { kind: "vat" as const, label: null, amount: "2.1" },
  ];
  const [a, b, c] = splitCharges(charges, ["1", "1", "1"]);
  expect(a).toEqual([
    { kind: "commission", label: null, amount: "3.33333333" },
    { kind: "vat", label: null, amount: "0.7" },
  ]);
  expect(c).toEqual([
    { kind: "commission", label: null, amount: "3.33333334" },
    { kind: "vat", label: null, amount: "0.7" },
  ]);
  expect(b).toEqual(a);
});

it("gives one part every charge whole", () => {
  const charges = [{ kind: "other" as const, label: "Custodia", amount: "5" }];
  expect(splitCharges(charges, ["0.5"])).toEqual([charges]);
});

it("leaves out a share that rounds to nothing", () => {
  const charges = [
    { kind: "commission" as const, label: null, amount: "0.00000001" },
  ];
  // Half of it rounds up for the first part, which leaves the last none.
  expect(splitCharges(charges, ["1", "1"])).toEqual([
    [{ kind: "commission", label: null, amount: "0.00000001" }],
    [],
  ]);
});
