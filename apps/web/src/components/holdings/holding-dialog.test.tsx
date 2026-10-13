jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";

import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";

import { HoldingDialog } from "./holding-dialog";
import {
  type HoldingFields,
  holdingRow,
  initialFields,
} from "./holding-fields";
import type { HoldingOrigin } from "@/lib/holdings/holding-name";
import type { AssetClass } from "@/lib/holdings/messages";

const PRINCIPAL = { id: "p1", name: "Principal" };
const ACCOUNT: SourceConnectionRow = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
  portfolio: { ...PRINCIPAL, archived: false },
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

function render(
  mode: "create" | "edit",
  fields: Partial<HoldingFields> = {},
  initialError?: string,
  extra: {
    details?: { origin: HoldingOrigin | undefined };
    accounts?: SourceConnectionRow[];
  } = {},
) {
  const initial = {
    ...initialFields(null, {
      accountId: "a1",
      portfolioId: "p1",
      today: TODAY,
    }),
    ...fields,
  };
  const row =
    mode === "edit"
      ? holdingRow(
          "h1",
          { ...initial, amount: "1" },
          {
            account: { id: "a1", institution: "IOL" },
            portfolio: PRINCIPAL,
            instrumentType:
              initial.assetClass === "instrument" ? "crypto" : null,
          },
        )
      : undefined;
  return renderToStaticMarkup(
    <HoldingDialog
      mode={mode}
      row={row}
      details={extra.details}
      accounts={extra.accounts ?? [ACCOUNT]}
      portfolios={[PRINCIPAL]}
      instruments={INSTRUMENTS}
      initial={initial}
      initialError={initialError}
      returnFocusTo={() => null}
      onClose={() => {}}
      onSubmit={() => true}
    />,
  );
}

const labels = (html: string) =>
  [...html.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map(([, text]) => text);

it.each([
  ["instrument", {}, ["Tipo", "Cuenta", "Cartera", "Instrumento", "Cantidad"]],
  [
    "cash",
    { currency: "USD" },
    ["Tipo", "Cuenta", "Cartera", "Moneda", "Monto", "Nombre (opcional)"],
  ],
  [
    "fixed_term",
    { currency: "ARS" },
    [
      "Tipo",
      "Cuenta",
      "Cartera",
      "Moneda",
      "Monto",
      "TNA (%)",
      "Desde",
      "Vence",
      "Nombre (opcional)",
    ],
  ],
  [
    "real_estate",
    { currency: "USD" },
    ["Tipo", "Cuenta", "Cartera", "Moneda", "Valor", "Valuado el", "Nombre"],
  ],
  [
    "other",
    { currency: "ARS" },
    ["Tipo", "Cuenta", "Cartera", "Moneda", "Valor", "Valuado el", "Nombre"],
  ],
] as const)("shows a %s holding's fields", (assetClass, extra, expected) => {
  const html = render("create", {
    assetClass: assetClass as AssetClass,
    ...extra,
  });
  expect(labels(html)).toEqual(expected);
});

it("shows the class, the account and the instrument of an edit as text", () => {
  const html = render("edit", { instrument: "BTC" });
  expect(labels(html)).toEqual(["Cartera", "Cantidad"]);
  expect(html).toContain("<dd>Cripto</dd>");
  expect(html).toContain("<dd>IOL</dd>");
  expect(html).toContain("<dd>BTC · Bitcoin</dd>");
});

it("reopens a duplicate on the instrument, with its alert", () => {
  const html = render(
    "create",
    { instrument: "BTC", amount: "1" },
    WRITE_MESSAGES.holdings.duplicate,
  );
  expect(html).toContain(`>${WRITE_MESSAGES.holdings.duplicate}</p>`);
  expect(html).toMatch(/<button[^>]*aria-invalid="true"[^>]*>/);
});

it("reopens an edit's duplicate on the portfolio it moved to", () => {
  const html = render(
    "edit",
    { instrument: "BTC" },
    WRITE_MESSAGES.holdings.duplicate,
  );
  const portfolio = new RegExp(`<button[^>]*id="[^"]*-portfolio"[^>]*>`).exec(
    html,
  )![0];
  expect(portfolio).toContain('aria-invalid="true"');
});

describe("with details", () => {
  const CASH = { assetClass: "cash" as const, currency: "ARS" as const };

  it("shows no origin and no report switch without them", () => {
    const html = render("edit", CASH);
    expect(html).not.toContain("Origen");
    expect(html).not.toContain("Incluir en el reporte");
  });

  it("shows where a holding came from and its report switch", () => {
    const html = render("edit", { ...CASH, inTaxReport: false }, undefined, {
      details: { origin: { kind: "manual" } },
    });
    expect(html).toContain("<dd>Cargada a mano</dd>");
    expect(labels(html)).toContain("Incluir en el reporte");
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="false"/);
  });

  it("links an imported holding to the imports", () => {
    const html = render("edit", CASH, undefined, {
      details: {
        origin: { kind: "import", fileName: "resumen.pdf", date: "2026-10-01" },
      },
    });
    expect(html).toContain(
      'class="underline" href="/import">Importada de resumen.pdf el 01/10/2026</a>',
    );
  });

  it("says the account's choice leaves the holding out", () => {
    const html = render("edit", CASH, undefined, {
      details: { origin: { kind: "manual" } },
      accounts: [{ ...ACCOUNT, includeInTaxReport: false }],
    });
    expect(html).toContain(
      "La cuenta IOL no se incluye en el reporte, así que esta tenencia tampoco.",
    );
    expect(html).toMatch(/role="switch"[^>]*aria-describedby="[^"]*-tax-note"/);
  });
});
