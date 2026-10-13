import { renderToStaticMarkup } from "react-dom/server";

import { AnswerTable } from "./answer-table";

it("lists each row with its day and value, or that it has no quote", () => {
  const html = renderToStaticMarkup(
    <AnswerTable
      table={{
        title: "Próximos 90 días",
        unit: "usd_mep",
        rows: [
          { date: "2026-11-21", label: "Dividendo · Apple", value: "10.87" },
          { date: "2026-12-31", label: "Cupón · GD30", value: null },
        ],
      }}
    />,
  );
  expect(html).toContain("Próximos 90 días");
  expect(html).toContain("21/11/2026");
  expect(html).toContain("US$ 10,87");
  expect(html).toContain("Sin cotización");
});
