import { renderToStaticMarkup } from "react-dom/server";

import {
  currencyOfLine,
  InstrumentPicker,
  lineOf,
  listingDetail,
  optionDetail,
  optionsOf,
  matchesInstrument,
  newListings,
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

it("matches an instrument by its dollar line", () => {
  expect(matchesInstrument(GD30, "gd30d")).toBe(true);
  expect(matchesInstrument(GD30, "GD30C")).toBe(true);
  expect(matchesInstrument(GD30, "gd31d")).toBe(false);
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

describe("a picker named without a visible label", () => {
  const named = (value: string) =>
    renderToStaticMarkup(
      <InstrumentPicker
        id="row-1"
        aria-label="Activo de la fila 1"
        instruments={[GD30, FCI]}
        value={value}
        onChange={() => {}}
        placeholder="Elegí un activo"
      />,
    );

  it("names the trigger by its own hidden name and the chosen instrument", () => {
    const html = named("GD30");
    expect(/<button[^>]*>/.exec(html)![0]).toContain(
      'aria-labelledby="row-1-label row-1-value"',
    );
    expect(html).toContain(
      '<span id="row-1-label" class="sr-only">Activo de la fila 1</span><span id="row-1-value" class="truncate">GD30 · Global 2030</span>',
    );
  });

  it("names the placeholder after the row while nothing is chosen", () => {
    expect(named("")).toContain(
      '<span id="row-1-label" class="sr-only">Activo de la fila 1</span><span id="row-1-value" class="truncate">Elegí un activo</span>',
    );
  });

  it("renders no hidden name when a visible label names it", () => {
    expect(render("GD30")).not.toContain("sr-only");
  });
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

describe("the closed picker and the keys that open it", () => {
  const key = (k: string) =>
    triggerKey({ key: k, altKey: false, ctrlKey: false, metaKey: false });

  it("renders no list, no option and no status while closed", () => {
    const html = render("GD30");
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Sin resultados");
    expect(/<button[^>]*>/.exec(html)![0]).toContain('aria-expanded="false"');
  });

  it("starts the search with an uppercase letter typed with Shift", () => {
    expect(key("G")).toBe("G");
  });

  it.each(["ñ", "Ñ", "á", "é"])("starts the search with %s", (typed) => {
    expect(key(typed)).toBe(typed);
  });

  it("leaves named keys to the button", () => {
    expect(key("Escape")).toBeNull();
    expect(key("Dead")).toBeNull();
    expect(key("Backspace")).toBeNull();
    expect(key("Shift")).toBeNull();
  });

  it("matches what a key on the trigger starts the search with", () => {
    expect(matchesInstrument(GD30, key("G")!)).toBe(true);
    expect(matchesInstrument(FCI, key("Á")!)).toBe(true);
  });
});

describe("keys the other cases leave unpinned", () => {
  it("leaves an Alt shortcut to the button, as Ctrl and Meta ones", () => {
    expect(
      triggerKey({ key: "g", altKey: true, ctrlKey: false, metaKey: false }),
    ).toBeNull();
  });

  it("stays on ArrowUp in an empty list, as on ArrowDown", () => {
    expect(searchKey("ArrowUp", 0, 0)).toEqual({ kind: "stay" });
  });

  it("picks nothing with Enter when the active option is past the list", () => {
    expect(searchKey("Enter", 2, 2)).toEqual({ kind: "stay" });
    expect(searchKey("Enter", 1, 2)).toEqual({ kind: "choose", index: 1 });
  });
});

const GGAL = {
  symbol: "GGAL",
  name: "Grupo Financiero Galicia",
  type: "stock",
  currency: "ARS",
  market: "byma",
} as const;

it("describes a market listing by type, currency and market", () => {
  expect(listingDetail(GGAL)).toBe("Acción · ARS · BYMA");
  expect(
    listingDetail({
      symbol: "BTC",
      name: "Bitcoin",
      type: "crypto",
      currency: "USD",
      market: "crypto",
    }),
  ).toBe("Cripto · USD · Cripto");
});

it("offers only the listings the catalog does not have", () => {
  expect(newListings([GGAL, { ...GGAL, symbol: "GD30" }], [GD30, FCI])).toEqual(
    [GGAL],
  );
});

const AAPL = {
  symbol: "AAPL",
  name: "Apple",
  type: "cedear",
  currency: "ARS",
} as const;

it("offers a CEDEAR in pesos on its MEP and cable lines, with lines", () => {
  expect(optionsOf(AAPL, true).map(({ key, line }) => [key, line])).toEqual([
    ["AAPL", null],
    ["AAPLD", "D"],
    ["AAPLC", "C"],
  ]);
  expect(optionsOf(AAPL, false).map(({ key }) => key)).toEqual(["AAPL"]);
});

it("offers a dollar bond and a crypto on one line only", () => {
  const GD30D = {
    symbol: "GD30",
    name: "Global 2030",
    type: "bond",
    currency: "USD",
  } as const;
  const BTC = {
    symbol: "BTC",
    name: "Bitcoin",
    type: "crypto",
    currency: "USD",
  } as const;
  expect(optionsOf(GD30D, true).map(({ key }) => key)).toEqual(["GD30"]);
  expect(optionsOf(BTC, true).map(({ key }) => key)).toEqual(["BTC"]);
});

it("names each line's currency, and a market line's market", () => {
  const [peso, mep, cable] = optionsOf(AAPL, true);
  expect(optionDetail(peso!, true, AAPL)).toBe("En pesos");
  expect(optionDetail(mep!, true, AAPL)).toBe("En dólares MEP");
  expect(optionDetail(cable!, true, AAPL)).toBe("En dólares cable");
  const listing = { ...AAPL, market: "byma" } as const;
  const [, marketMep] = optionsOf({ ...listing, listing }, true);
  expect(optionDetail(marketMep!, true)).toBe("CEDEAR · En dólares MEP · BYMA");
  expect(
    optionDetail(optionsOf({ ...listing, listing }, false)[0]!, false),
  ).toBe("CEDEAR · ARS · BYMA");
});

it("reads a CEDEAR valued in dollars as its MEP line", () => {
  expect(lineOf(AAPL, "USD")).toBe("D");
  expect(lineOf(AAPL, "ARS")).toBeNull();
  expect(lineOf({ type: "crypto", currency: "USD" }, "USD")).toBeNull();
  expect(currencyOfLine(AAPL, "C")).toBe("USD");
  expect(currencyOfLine(AAPL, null)).toBe("ARS");
});
