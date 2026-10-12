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
import type { HoldingRow } from "@/lib/holdings/read";

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

function render(holdings: InstrumentHolding[]) {
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
      accounts={[]}
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

it("says the user holds none of it once the last holding is gone", () => {
  const html = render([]);
  expect(html).toContain("No tenés Ethereum en ninguna cuenta.");
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
      'aria-label="Editar venta del 01/10/2026 en IOL · Principal"',
    );
    expect(html).toContain(
      'aria-label="Borrar venta del 01/10/2026 en IOL · Principal"',
    );
    // A line of a holding the page no longer lists takes neither action.
    expect(html).not.toContain('aria-label="Editar venta del 01/09/2026"');
    expect(html).not.toContain('aria-label="Borrar venta del 01/09/2026"');
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
