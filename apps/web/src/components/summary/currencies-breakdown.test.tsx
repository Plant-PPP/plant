import { renderToStaticMarkup } from "react-dom/server";

import type { Sum } from "@/lib/holdings/valuation-view";

import { CurrenciesBreakdown } from "./currencies-breakdown";

const sum = (complete: boolean): Sum => ({
  value: "1200000",
  complete,
  count: 1,
  missing: complete ? 0 : 1,
  share: "0.545",
});

const render = (total: Sum) =>
  renderToStaticMarkup(
    <CurrenciesBreakdown
      currencies={{ USD: sum(true) }}
      total={total}
      unit="ars"
    />,
  );

it("marks a currency's share when the whole leaves holdings out", () => {
  expect(render(sum(false))).not.toBe(render(sum(true)));
});
