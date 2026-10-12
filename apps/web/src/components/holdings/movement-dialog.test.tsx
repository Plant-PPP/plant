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
  const html = render({ ...moving, price: "61000", costEdited: true }, "60000");
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
