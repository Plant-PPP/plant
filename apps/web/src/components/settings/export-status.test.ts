import { EXPORT_FAILED, EXPORT_PARTIAL, exportOutcome } from "./export-status";

const tables = [
  { name: "cargas", label: "Cargas", header: ["Archivo"], rows: [["a"]] },
];

it("asks for the step-up when the server does", () => {
  expect(exportOutcome({ stepUp: "sign_in_again" })).toEqual({
    kind: "step_up",
  });
});

it("says the export failed when it could not be read", () => {
  expect(exportOutcome(null)).toEqual({
    kind: "failed",
    notice: EXPORT_FAILED,
  });
});

it("saves a whole export without a notice", () => {
  expect(exportOutcome({ tables, truncated: false })).toEqual({
    kind: "save",
    tables,
    notice: null,
  });
});

it("saves a cut export and says it is partial", () => {
  expect(exportOutcome({ tables, truncated: true })).toEqual({
    kind: "save",
    tables,
    notice: EXPORT_PARTIAL,
  });
});
