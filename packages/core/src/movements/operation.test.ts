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

it("leaves out a share that is cut to nothing", () => {
  const charges = [
    { kind: "commission" as const, label: null, amount: "0.00000001" },
  ];
  // Half of it is cut to 0 for the first part; the last takes it whole.
  expect(splitCharges(charges, ["1", "1"])).toEqual([
    [],
    [{ kind: "commission", label: null, amount: "0.00000001" }],
  ]);
});

it("never lets the early parts add up to more than the charge", () => {
  const charges = [
    { kind: "commission" as const, label: null, amount: "0.00000002" },
  ];
  const parts = splitCharges(charges, ["1", "1", "1", "1"]).flat();
  expect(parts.map((each) => each.amount)).toEqual(["0.00000002"]);
});
