import { renderToStaticMarkup } from "react-dom/server";

import {
  InstrumentPicker,
  matchesInstrument,
  searchKey,
  triggerKey,
} from "./instrument-picker";

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

it("shows the placeholder, muted, for a value the list does not have", () => {
  const html = render("MSFT");
  expect(html).toContain(">Elegí un instrumento</span>");
  expect(/<button[^>]*>/.exec(html)![0]).toContain("text-muted-foreground");
});

it("renders a trigger with the placeholder for an empty list", () => {
  const html = renderToStaticMarkup(
    <InstrumentPicker
      id="f-instrument"
      labelId="f-instrument-label"
      instruments={[]}
      value=""
      onChange={() => {}}
      placeholder="Elegí un instrumento"
    />,
  );
  expect(html).toContain(">Elegí un instrumento</span>");
  expect(html).not.toContain('role="listbox"');
});

describe("keys in the search", () => {
  it("moves the active option down and up, wrapping at the ends", () => {
    expect(searchKey("ArrowDown", 0, 3)).toEqual({ kind: "move", active: 1 });
    expect(searchKey("ArrowDown", 2, 3)).toEqual({ kind: "move", active: 0 });
    expect(searchKey("ArrowUp", 0, 3)).toEqual({ kind: "move", active: 2 });
  });

  it("picks the active option with Enter, and keeps Enter from the form with none", () => {
    expect(searchKey("Enter", 1, 3)).toEqual({ kind: "choose", index: 1 });
    expect(searchKey("Enter", 0, 0)).toEqual({ kind: "stay" });
    expect(searchKey("ArrowDown", 0, 0)).toEqual({ kind: "stay" });
  });

  it("closes with Tab and leaves typed text to the search", () => {
    expect(searchKey("Tab", 0, 3)).toEqual({ kind: "close" });
    expect(searchKey("g", 0, 3)).toBeNull();
    expect(searchKey("Escape", 0, 3)).toBeNull();
  });
});

describe("keys on the closed trigger", () => {
  const key = (
    k: string,
    mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey", boolean>> = {},
  ) =>
    triggerKey({
      key: k,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...mods,
    });

  it("opens on an arrow with an empty search", () => {
    expect(key("ArrowDown")).toBe("");
    expect(key("ArrowUp")).toBe("");
  });

  it("starts the search with a typed character", () => {
    expect(key("g")).toBe("g");
    expect(key("3")).toBe("3");
  });

  it("leaves shortcuts, Space, Enter and Tab to the button", () => {
    expect(key("c", { ctrlKey: true })).toBeNull();
    expect(key("c", { metaKey: true })).toBeNull();
    expect(key(" ")).toBeNull();
    expect(key("Enter")).toBeNull();
    expect(key("Tab")).toBeNull();
  });
});
