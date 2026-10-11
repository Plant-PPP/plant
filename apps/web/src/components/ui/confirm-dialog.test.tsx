import { renderToStaticMarkup } from "react-dom/server";

import { ConfirmDialog } from "./confirm-dialog";

jest.mock("@/components/ui/app-dialog", () => ({
  AppDialog: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: React.ReactNode;
  }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  ),
}));

it("asks with the action named, opening on Cancelar", () => {
  const html = renderToStaticMarkup(
    <ConfirmDialog
      title="¿Borrar Visa?"
      description="No se puede deshacer."
      confirmLabel="Borrar"
      returnFocusTo={() => null}
      onClose={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(html).toContain("¿Borrar Visa?");
  expect(html).toContain("No se puede deshacer.");
  // Only Cancelar takes focus when it opens.
  expect(html.match(/autofocus/gi)).toHaveLength(1);
  expect(html).toMatch(/<button[^>]*autofocus[^>]*>Cancelar<\/button>/i);
  expect(html).toMatch(/>Borrar<\/button>/);
});
