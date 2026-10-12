jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";

import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";

import { MovementDialog } from "./movement-dialog";
import {
  type MovementFields,
  newMovementFields,
  withKind,
  withShownPrice,
} from "./movement-fields";

const PRINCIPAL = { id: "p1", name: "Principal", archived: false };
const LARGO = { id: "p2", name: "Largo plazo", archived: false };
const ACCOUNT: SourceConnectionRow = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
  holder: null,
  portfolio: PRINCIPAL,
};
const INSTRUMENTS = [
  {
    symbol: "BTC",
    name: "Bitcoin",
    currency: "USD" as const,
    type: "crypto" as const,
  },
];
const TODAY = "2026-10-10";
const moving = withKind(
  {
    ...newMovementFields({
      kind: "purchase",
      accountId: "a1",
      instrument: "BTC",
      currency: "USD",
      date: TODAY,
      portfolioId: "p1",
    }),
    parts: [{ portfolioId: "p1", size: "0,5" }],
  },
  "transfer",
  "p1",
);

const render = (
  initial: MovementFields,
  suggested: string | null,
  initialError?: string,
) =>
  renderToStaticMarkup(
    <MovementDialog
      mode="create"
      accounts={[ACCOUNT]}
      portfolios={[PRINCIPAL, LARGO]}
      instruments={INSTRUMENTS}
      fixed={{ account: "IOL", instrument: "Bitcoin" }}
      transfer={{ from: "p1", suggestedCost: () => suggested }}
      initial={initial}
      initialError={initialError}
      today={TODAY}
      returnFocusTo={() => null}
      onClose={() => {}}
      onSubmit={() => true}
    />,
  );

it("shows where the units leave from, the cost they carry and no charges", () => {
  const html = render(moving, "60000");
  expect(html).toContain("Desde");
  expect(html).toContain("Principal");
  expect(html).toContain("Hacia");
  expect(html).toContain('value="60000"');
  expect(html).toContain("Sugerido: el costo que tenían.");
  expect(html).toContain(
    "Si lo cambiás, entran con ese costo y la diferencia se ve en el resultado de la tenencia.",
  );
  expect(html).not.toContain("Gastos");
  expect(html).not.toContain("Repartir en otra cartera");
});

it("keeps a changed cost and offers the suggestion back", () => {
  const html = render(
    { ...moving, price: "61000", priceEdited: true },
    "60000",
  );
  expect(html).toContain('value="61000"');
  expect(html).toContain("Usar el sugerido (US$ 60.000,00)");
  expect(html).not.toContain("Sugerido: el costo que tenían.");
});

it("labels every control it names and describes the cost by its help", () => {
  const html = render(moving, "60000");
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const targets = [...html.matchAll(/ for="([^"]+)"/g)].map((m) => m[1]);
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) expect(ids).toContain(target);
  const cost = html.match(/<input[^>]*id="([^"]+-price)"[^>]*>/)!;
  expect(cost[0]).toContain(`aria-describedby="${cost[1]}-help"`);
  expect(ids).toContain(`${cost[1]}-help`);
});

it("says a cost left empty carries the one the units had when none is suggested", () => {
  expect(render(moving, null)).toContain(
    "Si lo dejás vacío, entran con el costo que tenían.",
  );
});

describe("a refused transfer's focus", () => {
  const focused = (html: string) =>
    [...html.matchAll(/<(?:input|button)[^>]*autofocus[^>]*>/gi)].map(
      (tag) => tag[0].match(/ id="([^"]+)"/)?.[1],
    );

  it("goes to where the units go while none is chosen", () => {
    const ids = focused(render(moving, "60000", MOVEMENT_MESSAGES.oversold));
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/-parts-to$/);
  });

  it("goes to the quantity once they have somewhere to go", () => {
    const ids = focused(
      render(
        {
          ...moving,
          parts: [moving.parts[0]!, { portfolioId: "p2", size: "0,5" }],
        },
        "60000",
        MOVEMENT_MESSAGES.oversold,
      ),
    );
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/-parts$/);
  });
});

describe("a yield", () => {
  const earning = withKind(
    newMovementFields({
      kind: "purchase",
      accountId: "a1",
      instrument: "BTC",
      currency: "USD",
      date: TODAY,
      portfolioId: "p1",
    }),
    "yield",
    "p1",
  );
  const asked: unknown[] = [];
  const renderYield = (initial: MovementFields, quote: string | null) =>
    renderToStaticMarkup(
      <MovementDialog
        mode="create"
        accounts={[ACCOUNT]}
        portfolios={[PRINCIPAL, LARGO]}
        instruments={INSTRUMENTS}
        fixed={{ account: "IOL", instrument: "Bitcoin" }}
        yields={{
          portfolio: "p1",
          quoteOn: (query) => {
            asked.push(query);
            return quote;
          },
        }}
        initial={initial}
        today={TODAY}
        returnFocusTo={() => null}
        onClose={() => {}}
        onSubmit={() => true}
      />,
    );

  it("suggests the day's quote as each unit's value, with no charges", () => {
    const html = renderYield(earning, "61000");
    expect(asked).toContainEqual({
      symbol: "BTC",
      currency: "USD",
      date: TODAY,
    });
    expect(html).toContain("Valor por unidad");
    expect(html).toContain('value="61000"');
    expect(html).toContain("Sugerido: el precio de ese día.");
    expect(html).toContain(">Cargar<");
    expect(html).toContain(">Resultado<");
    expect(html).toContain(">Cantidad<");
    expect(html).not.toContain("Gastos");
    expect(html).not.toContain("Repartir en otra cartera");
  });

  it("asks for the value when nothing quotes that day", () => {
    expect(renderYield(earning, null)).toContain(
      "No hay precio para ese día: ingresá el valor por unidad.",
    );
  });

  it("asks for a bond's value as it is quoted", () => {
    const html = renderToStaticMarkup(
      <MovementDialog
        mode="create"
        accounts={[ACCOUNT]}
        portfolios={[PRINCIPAL]}
        instruments={[
          { symbol: "AL30", name: "Bonar", currency: "USD", type: "bond" },
        ]}
        fixed={{ account: "IOL", instrument: "Bonar" }}
        yields={{ portfolio: "p1", quoteOn: () => null }}
        initial={{ ...earning, instrument: "AL30" }}
        today={TODAY}
        returnFocusTo={() => null}
        onClose={() => {}}
        onSubmit={() => true}
      />,
    );
    expect(html).toContain("Valor cada 100 VN");
    expect(html).toContain(
      "No hay precio para ese día: ingresá el valor cada 100 VN.",
    );
  });

  it("keeps following the day's quote when it opens again", () => {
    const sent = withShownPrice(earning, "61000", "crypto");
    expect(renderYield(sent, "59000")).toContain('value="59000"');
  });

  it("points a refused balance at its field, with its help", () => {
    const html = renderToStaticMarkup(
      <MovementDialog
        mode="create"
        accounts={[ACCOUNT]}
        portfolios={[PRINCIPAL]}
        instruments={INSTRUMENTS}
        fixed={{ account: "IOL", instrument: "Bitcoin" }}
        yields={{ portfolio: "p1", quoteOn: () => "61000" }}
        initial={{ ...earning, balance: "3" }}
        initialError={MOVEMENT_MESSAGES.same_balance}
        today={TODAY}
        returnFocusTo={() => null}
        onClose={() => {}}
        onSubmit={() => true}
      />,
    );
    const focused = [...html.matchAll(/<input[^>]*autofocus[^>]*>/gi)];
    expect(focused).toHaveLength(1);
    expect(focused[0]![0]).toMatch(/ id="[^"]+-parts"/);
    const described = focused[0]![0].match(/aria-describedby="([^"]+)"/)![1]!;
    expect(described.split(" ")).toEqual([
      expect.stringMatching(/-alert$/),
      expect.stringMatching(/-parts-help$/),
    ]);
  });

  it("takes the final balance instead of the units", () => {
    const html = renderYield({ ...earning, balance: "3" }, "61000");
    expect(html).toContain("Saldo final");
    expect(html).toContain('value="3"');
    expect(html).toContain("se carga como rendimiento");
    expect(html).not.toContain(">Resultado<");
  });

  it("labels every control it names", () => {
    for (const html of [
      renderYield(earning, "61000"),
      renderYield({ ...earning, balance: "" }, null),
    ]) {
      const ids = new Set(
        [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]),
      );
      for (const [, target] of html.matchAll(/ for="([^"]+)"/g)) {
        expect(ids).toContain(target);
      }
      for (const [, described] of html.matchAll(
        / aria-describedby="([^"]+)"/g,
      )) {
        for (const each of described!.split(" ")) expect(ids).toContain(each);
      }
    }
  });
});
