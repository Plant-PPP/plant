jest.mock("@/app/(app)/accounts/actions", () => ({}));
jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import {
  type SourceConnectionFields,
  SourceConnectionDialog,
  initialFields,
} from "./source-connection-dialog";

const PRINCIPAL = { id: "p1", name: "Principal" };

function render(
  initialError?: string,
  change: Partial<SourceConnectionFields> = {},
  holders: { id: string; name: string }[] = [],
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
      holders={holders}
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
const LABELS = ["Institución", "Titular", "Cartera por defecto"];

function marked(html: string, attribute: string): string[] {
  return LABELS.filter((label) => control(html, label).includes(attribute));
}

function alertId(html: string): string | undefined {
  return /<p[^>]*id="([^"]+)"[^>]*role="alert"/.exec(html)?.[1];
}

it("opens again with the refused fields and the alert", () => {
  const html = render(MESSAGES.failed);
  expect(html).toMatch(
    new RegExp(`<p[^>]*role="alert"[^>]*>${MESSAGES.failed}</p>`),
  );
  expect(html).toMatch(/<input[^>]*value="IOL"/);
  expect(html).toMatch(
    new RegExp(
      `<button[^>]*type="submit"[^>]*aria-describedby="${alertId(html)}"`,
    ),
  );
});

it("opens with no alert, starting on the institution, when nothing was refused", () => {
  const html = render(undefined, { holder: "" });
  expect(html).not.toContain('role="alert"');
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
  expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*aria-describedby=/);
});

it("marks no field when the alert is about the save itself", () => {
  const html = render(MESSAGES.failed, { holder: "" });
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "aria-describedby=")).toEqual([]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
});

it("marks, describes and focuses the institution when it was refused", () => {
  const html = render(MESSAGES.invalid);
  expect(marked(html, 'aria-invalid="true"')).toEqual(["Institución"]);
  expect(marked(html, `aria-describedby="${alertId(html)}"`)).toEqual([
    "Institución",
  ]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
});

it("marks, describes and focuses the holder when it was archived", () => {
  const html = render(MESSAGES.holder_archived, {
    holder: "h-archived",
    defaultPortfolioId: "p-archived",
  });
  expect(marked(html, 'aria-invalid="true"')).toEqual(["Titular"]);
  expect(marked(html, `aria-describedby="${alertId(html)}"`)).toEqual([
    "Titular",
  ]);
  expect(marked(html, "autofocus")).toEqual(["Titular"]);
});

it("marks the portfolio, not the holder, when the portfolio was archived", () => {
  const html = render(MESSAGES.portfolio_archived, {
    holder: "h-archived",
    defaultPortfolioId: "p-archived",
  });
  expect(marked(html, 'aria-invalid="true"')).toEqual(["Cartera por defecto"]);
  expect(marked(html, "autofocus")).toEqual(["Cartera por defecto"]);
});

it("starts with an archived holder or portfolio unchosen", () => {
  const html = render(undefined, {
    holder: "h-archived",
    defaultPortfolioId: "p-archived",
  });
  expect(html).toContain("Elegí un titular");
  expect(html).toContain("Elegí una cartera");
});

it("treats a holder the page offers as chosen", () => {
  const html = render(undefined, { holder: "h1" }, [
    { id: "h1", name: "Lucía" },
  ]);
  expect(html).not.toContain("Elegí un titular");
});

it("marks no field when the account changed elsewhere", () => {
  const html = render(MESSAGES.not_found);
  expect(html).toContain(MESSAGES.not_found);
  expect(marked(html, 'aria-invalid="true"')).toEqual([]);
  expect(marked(html, "autofocus")).toEqual(["Institución"]);
});

describe("editing an account", () => {
  const account: SourceConnectionRow = {
    id: "c1",
    institution: "IOL",
    includeInTaxReport: true,
    holder: { id: "h1", name: "Lucía", archived: false },
    portfolio: { ...PRINCIPAL, archived: false },
  };

  function renderEdit(
    row: SourceConnectionRow,
    holders: { id: string; name: string }[],
  ) {
    return render(undefined, initialFields(row, [PRINCIPAL]), holders);
  }

  it("unchooses only the holder when the page no longer lists it", () => {
    const html = renderEdit(account, []);
    expect(html).toContain("Elegí un titular");
    expect(html).not.toContain("Elegí una cartera");
  });

  it("keeps the user's own holder chosen with no holders listed", () => {
    const html = renderEdit({ ...account, holder: null }, []);
    expect(html).not.toContain("Elegí un titular");
  });
});

it("keeps the messages that name a field apart from every other", () => {
  const named = [
    MESSAGES.invalid,
    MESSAGES.holder_archived,
    MESSAGES.portfolio_archived,
  ];
  const others = Object.entries(MESSAGES)
    .filter(
      ([code]) =>
        !["invalid", "holder_archived", "portfolio_archived"].includes(code),
    )
    .map(([, text]) => text);
  expect(new Set(named).size).toBe(named.length);
  for (const text of named) expect(others).not.toContain(text);
});
