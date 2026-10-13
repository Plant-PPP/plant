import { renderToStaticMarkup } from "react-dom/server";

import { InstrumentPicker, matchesInstrument } from "./instrument-picker";

const GD30 = { symbol: "GD30", name: "Global 2030" };
const FCI = { symbol: "FIMAAHO", name: "FCI Ahorro Pesos" };

it.each([
  ["", true],
  ["gd", true],
  ["GD30", true],
  ["global", true],
  ["  2030 ", true],
  ["bonar", false],
])("matches %j against GD30: %s", (query, expected) => {
  expect(matchesInstrument(GD30, query)).toBe(expected);
});

it("ignores accents in the query and the name", () => {
  expect(matchesInstrument({ symbol: "X", name: "Crédito" }, "credito")).toBe(
    true,
  );
  expect(matchesInstrument(FCI, "ahórro")).toBe(true);
});

const render = (value: string, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <InstrumentPicker
      id="f-instrument"
      labelId="f-instrument-label"
      instruments={[GD30, FCI]}
      value={value}
      onChange={() => {}}
      placeholder="Elegí un instrumento"
      {...extra}
    />,
  );

it("names the trigger by its label and the chosen instrument", () => {
  const html = render("GD30");
  const trigger = /<button[^>]*>/.exec(html)![0];
  expect(trigger).toContain('id="f-instrument"');
  expect(trigger).toContain(
    'aria-labelledby="f-instrument-label f-instrument-value"',
  );
  expect(trigger).toContain('aria-haspopup="dialog"');
  expect(html).toContain(
    '<span id="f-instrument-value" class="truncate">GD30 · Global 2030</span>',
  );
});

it("shows the placeholder until an instrument is chosen", () => {
  expect(render("")).toContain(">Elegí un instrumento</span>");
});

it("carries a refusal's aria to the trigger", () => {
  const trigger = /<button[^>]*>/.exec(
    render("", { "aria-invalid": true, "aria-describedby": "f-alert" }),
  )![0];
  expect(trigger).toContain('aria-invalid="true"');
  expect(trigger).toContain('aria-describedby="f-alert"');
});
