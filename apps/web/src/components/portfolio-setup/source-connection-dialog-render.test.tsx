jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import {
  type SourceConnectionFields,
  SourceConnectionDialog,
  initialFields,
} from "./source-connection-dialog";

const PRINCIPAL = { id: "p1", name: "Principal" };

function render(
  initialError?: string,
  change: Partial<SourceConnectionFields> = {},
) {
  return renderToStaticMarkup(
    <SourceConnectionDialog
      title="Nueva cuenta"
      description="d"
      submitLabel="Agregar"
      initial={{
        ...initialFields(null, [PRINCIPAL]),
        institution: "IOL",
        ...change,
      }}
      initialError={initialError}
      portfolios={[PRINCIPAL]}
      returnFocusTo={() => null}
      onClose={() => {}}
      onSubmit={() => true}
    />,
  );
}

// The opening tag of the control a label names.
function control(html: string, label: string): string {
  const id = new RegExp(`for="([^"]+)">${label}</label>`).exec(html)?.[1];
  return new RegExp(`<(?:input|button)[^>]* id="${id}"[^>]*>`).exec(html)![0];
}

const MESSAGES = WRITE_MESSAGES.source_connections;
const LABELS = ["Institución", "Cartera por defecto"];

function marked(html: string, attribute: string): string[] {
  return LABELS.filter((label) => control(html, label).includes(attribute));
}

// The field Otra opens for an institution the list does not have.
function nameInput(html: string): string | undefined {
  return /<input[^>]*aria-label="Nombre de la institución"[^>]*>/.exec(
    html,
  )?.[0];
}

// The name field, when it shows.
function otherField(html: string): string | undefined {
  const field = nameInput(html);
  return field?.includes(" hidden") ? undefined : field;
}

function alertId(html: string): string | undefined {
  return /<p[^>]*id="([^"]+)"[^>]*role="alert"/.exec(html)?.[1];
}

it("opens again with the refused fields and the alert", () => {
  const html = render(MESSAGES.failed, { institution: "Mi broker" });
  expect(html).toMatch(
    new RegExp(`<p[^>]*role="alert"[^>]*>${MESSAGES.failed}</p>`),
  );
  expect(html).toMatch(/<input[^>]*value="Mi broker"/);
  expect(html).toMatch(
    new RegExp(
      `<button[^>]*type="submit"[^>]*aria-describedby="${alertId(html)}"`,
    ),
  );
});

it("opens with no alert, starting on the institution, when nothing was refused", () => {
  const html = render(undefined, { defaultPortfolioId: "" });
  expect(html).not.toContain('role="alert"');
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
  expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*aria-describedby=/);
});

it("marks no field when the alert is about the save itself", () => {
  const html = render(MESSAGES.failed, { defaultPortfolioId: "" });
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "aria-describedby=")).toEqual([]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
});

it("marks, describes and focuses the institution when it was refused", () => {
  const html = render(MESSAGES.invalid);
  expect(otherField(html)).toBeUndefined();
  expect(marked(html, 'aria-invalid="true"')).toEqual(["Institución"]);
  expect(marked(html, `aria-describedby="${alertId(html)}"`)).toEqual([
    "Institución",
  ]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
});

it("marks, describes and focuses the typed name, not the list, when an unlisted institution was refused", () => {
  const html = render(MESSAGES.invalid, { institution: "Mi broker" });
  const other = otherField(html)!;
  expect(other).toContain('aria-invalid="true"');
  expect(other).toContain(`aria-describedby="${alertId(html)}"`);
  expect(other).toContain("autofocus");
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "aria-describedby=")).toEqual([]);
  expect(marked(html, "autofocus")).toEqual([]);
});

describe("the institution", () => {
  it("starts a new account on the list's placeholder, with no field to type a name", () => {
    const html = render(undefined, { institution: "" });
    expect(control(html, "Institución")).toContain("data-placeholder");
    expect(html).toContain("Elegí una institución");
    expect(otherField(html)).toBeUndefined();
  });

  it("opens a listed institution chosen in the list, with no field to type a name", () => {
    const html = render(undefined, { institution: "Banco Nación" });
    expect(control(html, "Institución")).not.toContain("data-placeholder");
    expect(otherField(html)).toBeUndefined();
  });

  it("opens an unlisted institution under Otra, with its name typed", () => {
    const html = render(undefined, { institution: "Mi broker" });
    expect(control(html, "Institución")).not.toContain("data-placeholder");
    const other = otherField(html)!;
    expect(other).toContain('value="Mi broker"');
    expect(other).toContain("autofocus");
    expect(marked(html, "autofocus")).toEqual([]);
  });

  it("keeps the hidden name field mounted but unmarked when the list was refused", () => {
    const html = render(MESSAGES.invalid);
    const field = nameInput(html);
    expect(field).toContain(" hidden");
    expect(field).not.toContain("aria-invalid=");
    expect(field).not.toContain("aria-describedby=");
    expect(field).not.toContain("autofocus");
  });
});

it("marks, describes and focuses the portfolio when it was archived", () => {
  const html = render(MESSAGES.portfolio_archived, {
    defaultPortfolioId: "p-archived",
  });
  expect(marked(html, 'aria-invalid="true"')).toEqual(["Cartera por defecto"]);
  expect(marked(html, `aria-describedby="${alertId(html)}"`)).toEqual([
    "Cartera por defecto",
  ]);
  expect(marked(html, "autofocus")).toEqual(["Cartera por defecto"]);
});

it("starts with an archived portfolio unchosen", () => {
  const html = render(undefined, { defaultPortfolioId: "p-archived" });
  expect(html).toContain("Elegí una cartera");
});

it("treats a portfolio the page offers as chosen", () => {
  const html = render(undefined, { defaultPortfolioId: "p1" });
  expect(html).not.toContain("Elegí una cartera");
});

it("asks for the institution, the default portfolio and the report only", () => {
  const html = render();
  expect(
    [...html.matchAll(/<label[^>]*>([^<]+)<\/label>/g)].map(([, text]) => text),
  ).toEqual(["Institución", "Cartera por defecto", "Incluir en el reporte"]);
});

it("marks no field when the account changed elsewhere", () => {
  const html = render(MESSAGES.not_found);
  expect(html).toContain(MESSAGES.not_found);
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
});

it("keeps the messages that name a field apart from every other", () => {
  const named = [MESSAGES.invalid, MESSAGES.portfolio_archived];
  const others = Object.entries(MESSAGES)
    .filter(([code]) => !["invalid", "portfolio_archived"].includes(code))
    .map(([, text]) => text);
  expect(new Set(named).size).toBe(named.length);
  for (const text of named) expect(others).not.toContain(text);
});

it.each([true, false])(
  "links the report switch to its label and shows it %s, with no note or pending state",
  (includeInTaxReport) => {
    const html = render(undefined, { includeInTaxReport });
    const tag = control(html, "Incluir en el reporte");
    expect(tag).toMatch(/^<button[^>]*role="switch"/);
    expect(tag).toContain(`aria-checked="${includeInTaxReport}"`);
    expect(tag).not.toContain("aria-disabled");
    expect(tag).not.toContain("aria-describedby");
    expect(tag).not.toMatch(/\sdisabled=""/);
    expect(html).not.toMatch(/id="[^"]*-note"/);
  },
);
