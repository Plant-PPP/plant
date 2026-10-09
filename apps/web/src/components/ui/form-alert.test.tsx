import { renderToStaticMarkup } from "react-dom/server";
import { FormAlert } from "./form-alert";

it("is announced as an alert in the error color", () => {
  const html = renderToStaticMarkup(<FormAlert>No pudimos entrar.</FormAlert>);
  expect(html).toBe(
    '<p role="alert" data-slot="form-alert" class="text-sm text-destructive">No pudimos entrar.</p>',
  );
});

it("lets a dense spot replace the text size", () => {
  const html = renderToStaticMarkup(
    <FormAlert className="px-2 py-1.5 text-xs">x</FormAlert>,
  );
  expect(html).toContain('class="text-destructive px-2 py-1.5 text-xs"');
});
