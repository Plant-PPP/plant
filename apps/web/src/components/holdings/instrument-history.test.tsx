jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
// The page's "Agregar movimiento" starts on a preset a static render cannot
// open, so the test reads what the page asks it for.
jest.mock("./movement-dialogs", () => {
  const actual = jest.requireActual("./movement-dialogs");
  return { ...actual, instrumentPreset: jest.fn(actual.instrumentPreset) };
});

import { EMPTY_POSITION, holdingSchema } from "@plant/core";
import { sumOrNull } from "@plant/shared";
import { renderToStaticMarkup } from "react-dom/server";

import type { InstrumentHolding } from "@/lib/holdings/instrument-history";
import { instrumentSummary } from "@/lib/holdings/instrument-history";
import type { MovementLine } from "@/lib/holdings/movements-input";
import { assetKey } from "@/lib/holdings/assets-rows";
import type { HoldingRow } from "@/lib/holdings/read";

import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

import type { HoldingDetails } from "./assets-setup";
import { InstrumentHistory } from "./instrument-history";
import { instrumentPreset } from "./movement-dialogs";

const ETH = {
  symbol: "ETH",
  name: "Ethereum",
  type: "crypto" as const,
  currency: "USD" as const,
};

const row = (id: string, institution: string): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id: "p1",
    asset_class: "instrument",
    instrument_symbol: "ETH",
    amount: "1",
    currency: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: `a-${id}`, institution },
  portfolio: { id: "p1", name: "Principal" },
  instrumentType: "crypto",
});

const held = (
  id: string,
  institution: string,
  closed = false,
): InstrumentHolding => ({
  row: row(id, institution),
  closed,
  position: { ...EMPTY_POSITION, quantity: closed ? "0" : "1" },
  value: closed ? null : "2000",
});

const done = async () => ({ ok: true as const, id: "x" });

function render(
  holdings: InstrumentHolding[],
  extra: {
    details?: HoldingDetails;
    accounts?: SourceConnectionRow[];
  } = {},
) {
  return renderToStaticMarkup(
    <InstrumentHistory
      instrument={ETH}
      price={{ value: "2000", source: "feed", date: "2026-10-12" }}
      unit="usd_mep"
      referenceUnit="usd_mep"
      params={{}}
      backHref="/assets"
      holdings={holdings}
      summary={instrumentSummary(
        holdings,
        [],
        "2026-10-12",
        sumOrNull(
          holdings.flatMap((each) => (each.closed ? [] : [each.value])),
        ),
      )}
      movements={{
        positions: new Map(),
        revisions: new Map(),
        loadMovements: async () => ({ ok: true, rows: [], next: null }),
      }}
      movementActions={{ create: done, update: done, delete: done }}
      actions={{ delete: async () => ({ ok: true, id: "x" }) }}
      details={extra.details}
      accounts={extra.accounts ?? []}
      onAlert={async () => "ok"}
      portfolios={[]}
      instruments={[ETH]}
      today="2026-10-12"
    />,
  );
}

it("offers each holding's movements and delete, and a movement of the instrument", () => {
  const html = render([held("e1", "IOL"), held("e2", "Binance", true)]);
  expect(html).toContain(
    'aria-label="Agregar movimiento de ETH · Ethereum de IOL en Principal"',
  );
  expect(html).toContain(
    'aria-label="Borrar ETH · Ethereum de IOL en Principal"',
  );
  // A holding sold to zero takes no movement but can still be deleted.
  expect(html).not.toContain(
    'aria-label="Agregar movimiento de ETH · Ethereum de Binance en Principal"',
  );
  expect(html).toContain(
    'aria-label="Borrar ETH · Ethereum de Binance en Principal"',
  );
  expect(html).toContain(">Historial<");
  expect(html).toContain("Agregar movimiento</button>");
  expect(html).toContain("Cripto · ");
});

it("starts a movement of the instrument on its open holdings only", () => {
  jest.mocked(instrumentPreset).mockClear();
  render([held("e1", "IOL"), held("e2", "Binance", true)]);
  // The holding sold to zero would leave no single account to start on.
  expect(instrumentPreset).toHaveBeenCalledWith("ETH", [row("e1", "IOL")]);
  expect(jest.mocked(instrumentPreset).mock.results[0]?.value).toEqual({
    instrument: "ETH",
    accountId: "a-e1",
    portfolioId: "p1",
  });
});

it("offers the bell to set an alert on the instrument, held or not", () => {
  for (const holdings of [[held("e1", "IOL")], []]) {
    expect(render(holdings)).toContain('aria-label="Crear una alerta de ETH"');
  }
});

it("says the user holds none of it once the last holding is gone", () => {
  const html = render([]);
  expect(html).toContain("No tenés Ethereum");
  // No holding is left to value a unit of it.
  expect(html).not.toContain("Cripto ·");
  expect(html).not.toContain(">Historial<");
});

it("calculates a holding's cost and value until its write is saved", () => {
  const unsaved = { ...held("e1", "IOL"), unsaved: true as const };
  expect(render([held("e2", "Binance")])).not.toContain("Calculando…");
  // Its cost and its value.
  expect(
    render([unsaved, held("e2", "Binance")]).match(/Calculando…/g),
  ).toHaveLength(2);
});

describe("with movements loaded", () => {
  const sale = (id: string, holdingId: string, date: string): MovementLine => ({
    movement: {
      id,
      holding_id: holdingId,
      kind: "sale",
      date,
      currency: "USD",
      quantity: "0.5",
      price: "2000",
      charges: [],
      reference: null,
      note: null,
      operation_id: `op-${id}`,
      entry_order: 1,
      rates: {
        mep: { sell: "1200", date },
        ccl: { sell: "1250", date },
        official: { sell: "1000", date },
      },
    },
    amount: "1000",
    charges: null,
    operation: { accountId: "a-e1", instrument: "ETH", parts: [] },
  });

  // The movements table reads its first page in an effect, which a server
  // render never runs: it starts from the page already read.
  const React = jest.requireActual<typeof import("react")>("react");
  beforeEach(() => {
    const useState = React.useState;
    jest.spyOn(React, "useState").mockImplementation(((initial: unknown) =>
      typeof initial === "object" &&
      initial !== null &&
      "kind" in initial &&
      initial.kind === "loading"
        ? [
            {
              kind: "ready",
              rows: [
                sale("m1", "e1", "2026-10-01"),
                sale("m2", "gone", "2026-09-01"),
              ].map((line) => ({ ...line, id: line.movement.id })),
              next: null,
            },
            jest.fn(),
          ]
        : useState(initial)) as typeof React.useState);
  });
  afterEach(() => jest.restoreAllMocks());

  it("acts only on a movement of a holding the page lists", () => {
    const html = render([held("e1", "IOL")]);
    // A line names where it is, so two lines of one day stay apart.
    expect(html).toContain(
      'aria-label="Editar venta de 0,5 del 01/10/2026 en IOL · Principal"',
    );
    expect(html).toContain(
      'aria-label="Borrar venta de 0,5 del 01/10/2026 en IOL · Principal"',
    );
    // A line of a holding the page no longer lists takes neither action.
    expect(html).not.toContain("Editar venta de 0,5 del 01/09/2026");
    expect(html).not.toContain("Borrar venta de 0,5 del 01/09/2026");
  });

  it("puts each movement's type and holding under its date on a narrow table", () => {
    const html = render([held("e1", "IOL")]);
    expect(html).toMatch(
      /01\/10\/2026<span[^>]*@2xl:hidden[^>]*>Venta · IOL · Principal</,
    );
  });

  it("puts only the type under the date of a line whose holding is gone", () => {
    const html = render([held("e1", "IOL")]);
    expect(html).toMatch(/01\/09\/2026<span[^>]*@2xl:hidden[^>]*>Venta</);
  });
});

describe("with details", () => {
  const details = (
    inTaxReport: boolean,
    origin: HoldingDetails["originOf"] = () => ({ kind: "manual" }),
  ): HoldingDetails => ({
    originOf: origin,
    inTaxReport: (key) =>
      key === assetKey(row("e1", "IOL").holding) && inTaxReport,
    placementOf: () => "fixed_term",
    renewalOf: () => undefined,
    actions: {
      setInTaxReport: done,
      update: done,
      setPlacement: done,
      renew: done,
    },
  });

  it("has no report switch and no origin without them", () => {
    const html = render([held("e1", "IOL")]);
    expect(html).not.toContain("Incluir en el reporte");
    expect(html).not.toContain("Importada");
  });

  it("offers no report switch once the user holds none of it", () => {
    const html = render([], { details: details(false) });
    expect(html).not.toContain("Incluir en el reporte");
  });

  it("shows the asset's report switch with its choice", () => {
    const html = render([held("e1", "IOL")], { details: details(false) });
    expect(html).toContain("Incluir en el reporte</label>");
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="false"/);
    expect(html).not.toContain("en el reporte, así que");
  });

  it("links an imported holding to the imports, and says nothing of a typed one", () => {
    const html = render([held("e1", "IOL"), held("e2", "Binance")], {
      details: details(true, (id) =>
        id === "e1"
          ? { kind: "import", fileName: "iol.pdf", date: "2026-10-01" }
          : { kind: "manual" },
      ),
    });
    expect(html).toContain(">Importada de iol.pdf el 01/10/2026</a>");
    expect(html.match(/Importada de/g)).toHaveLength(2);
    expect(html).not.toContain("Cargada a mano");
  });

  it("weighs only the accounts that still hold it", () => {
    const excluded = (id: string) => ({
      id,
      institution: "IOL",
      includeInTaxReport: id === "a-e2",
      portfolio: { id: "p1", name: "Principal", archived: false },
    });
    const html = render([held("e1", "IOL"), held("e2", "Binance", true)], {
      details: details(true),
      accounts: [excluded("a-e1"), excluded("a-e2")],
    });
    expect(html).toContain("no se incluye en el reporte");
  });

  const outOfReport = (id: string, institution: string) => ({
    id,
    institution,
    includeInTaxReport: false,
    portfolio: { id: "p1", name: "Principal", archived: false },
  });

  it("names the one account holding it that leaves it out of the report", () => {
    const html = render([held("e1", "IOL")], {
      details: details(true),
      accounts: [outOfReport("a-e1", "IOL")],
    });
    expect(html).toContain(
      'La cuenta <a href="/accounts">IOL</a> no se incluye en el reporte, así que este activo tampoco.',
    );
  });

  it("names the one account when it holds two of the asset's holdings", () => {
    const inIol = (id: string, portfolio: string): InstrumentHolding => {
      const each = held(id, "IOL");
      return {
        ...each,
        row: {
          ...each.row,
          account: { id: "a-iol", institution: "IOL" },
          portfolio: { id: portfolio, name: portfolio },
        },
      };
    };
    const html = render(
      [
        inIol("e1", "Principal"),
        inIol("e2", "Largo"),
        held("e3", "Binance", true),
      ],
      {
        details: details(true),
        accounts: [outOfReport("a-iol", "IOL"), outOfReport("a-e3", "Binance")],
      },
    );
    expect(html).toContain(
      'La cuenta <a href="/accounts">IOL</a> no se incluye en el reporte, así que este activo tampoco.',
    );
    expect(html).not.toContain("donde lo tenés no se incluyen");
  });

  it("says the accounts leave it out when two accounts share an institution", () => {
    const html = render([held("e1", "IOL"), held("e2", "IOL")], {
      details: details(true),
      accounts: [outOfReport("a-e1", "IOL"), outOfReport("a-e2", "IOL")],
    });
    expect(html).toContain(
      '<a href="/accounts">cuentas</a> donde lo tenés no se incluyen en el reporte, así que este activo tampoco.',
    );
    expect(html).not.toContain("La cuenta <a");
  });

  it("says nothing of the accounts while one holding it is in the report", () => {
    const html = render([held("e1", "IOL"), held("e2", "Binance")], {
      details: details(true),
      accounts: [
        outOfReport("a-e1", "IOL"),
        { ...outOfReport("a-e2", "Binance"), includeInTaxReport: true },
      ],
    });
    expect(html).not.toContain("en el reporte, así que");
    expect(html).not.toMatch(/role="switch"[^>]*aria-describedby/);
  });

  it("names the one open holding's account, leaving out a sold holding's", () => {
    const html = render([held("e1", "IOL"), held("e2", "Binance", true)], {
      details: details(true),
      accounts: [outOfReport("a-e1", "IOL"), outOfReport("a-e2", "Binance")],
    });
    expect(html).toContain(
      'La cuenta <a href="/accounts">IOL</a> no se incluye en el reporte, así que este activo tampoco.',
    );
    expect(html).not.toContain("donde lo tenés");
  });

  it("keeps the note while only a sold holding's account is in the report", () => {
    const html = render([held("e1", "IOL"), held("e2", "Binance", true)], {
      details: details(true),
      accounts: [
        outOfReport("a-e1", "IOL"),
        { ...outOfReport("a-e2", "Binance"), includeInTaxReport: true },
      ],
    });
    expect(html).toMatch(/role="switch"[^>]*aria-describedby="[^"]*-tax-note"/);
    expect(html).toContain(
      'La cuenta <a href="/accounts">IOL</a> no se incluye en el reporte',
    );
  });

  it("adds no note once every holding of it is sold", () => {
    const html = render([held("e1", "IOL", true)], {
      details: details(true),
      accounts: [outOfReport("a-e1", "IOL")],
    });
    expect(html).toContain("Incluir en el reporte");
    expect(html).not.toContain("no se incluye en el reporte");
    expect(html).not.toMatch(/role="switch"[^>]*aria-describedby/);
  });

  it("says the accounts holding it leave it out of the report", () => {
    const html = render([held("e1", "IOL"), held("e2", "Binance")], {
      details: details(true),
      accounts: [outOfReport("a-e1", "IOL"), outOfReport("a-e2", "Binance")],
    });
    expect(html).toContain(
      '<a href="/accounts">cuentas</a> donde lo tenés no se incluyen en el reporte, así que este activo tampoco.',
    );
  });
});
