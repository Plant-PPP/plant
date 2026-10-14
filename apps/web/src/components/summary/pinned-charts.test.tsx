import { renderToStaticMarkup } from "react-dom/server";

import { barsOf } from "@/lib/assistant/chat";

import { PinnedCharts } from "./pinned-charts";

it("names each unpin button by its chart", () => {
  const html = renderToStaticMarkup(
    <PinnedCharts
      pinned={[
        {
          id: "c1",
          chart: barsOf("bars", "Por moneda", "ars", [
            { label: "ARS", value: "100" },
          ]),
          asOf: "2026-10-14",
        },
        { id: "c2", chart: null, asOf: "2026-10-14" },
      ]}
      onUnpin={async () => true}
    />,
  );
  expect(html).toContain('aria-label="Soltar: Por moneda"');
  expect(html).toContain('aria-label="Soltar: gráfico"');
});
