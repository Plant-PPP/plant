jest.mock("radix-ui", () =>
  jest.requireActual("@/test/inline-dialog-portal").radixWithInlinePortal(),
);

import { renderToStaticMarkup } from "react-dom/server";
import { NameDialog } from "./name-dialog";
import type { Retry } from "./setup-card";

function render(retry: Retry<string> = {}) {
  return renderToStaticMarkup(
    <NameDialog
      onClose={() => {}}
      title="Renombrar cartera"
      description="d"
      submitLabel="Guardar"
      blankError="Usá entre 1 y 40 letras, números o signos."
      returnFocusTo={() => null}
      onSubmit={() => true}
      {...retry}
    />,
  );
}

it("opens again with the refused name and its alert", () => {
  const html = render({ initial: "Principal", initialError: "Ya existe" });
  expect(html).toMatch(/<input[^>]*aria-invalid="true"[^>]*value="Principal"/);
  expect(html).toMatch(/<p[^>]*data-slot="form-alert"[^>]*>Ya existe<\/p>/);
});

it("names the field and points it at its alert", () => {
  const html = render({ initial: "Principal", initialError: "Ya existe" });
  const inputId = /<label[^>]*for="([^"]+)"[^>]*>Nombre<\/label>/.exec(
    html,
  )?.[1];
  const alertId = /<p[^>]*id="([^"]+)"[^>]*data-slot="form-alert"/.exec(
    html,
  )?.[1];
  expect(inputId).toBeDefined();
  expect(alertId).toBeDefined();
  expect(html).toMatch(
    new RegExp(`<input[^>]*id="${inputId}"[^>]*aria-describedby="${alertId}"`),
  );
});

it("opens empty with no alert", () => {
  const html = render();
  expect(html).toContain("Renombrar cartera");
  expect(html).not.toContain('data-slot="form-alert"');
  expect(html).not.toContain("aria-invalid=");
  expect(html).toMatch(/<input[^>]*value=""/);
});

it("does not show the blank-name alert when it opens", () => {
  expect(render({ initial: "Principal" })).not.toContain("Usá entre 1 y 40");
});
