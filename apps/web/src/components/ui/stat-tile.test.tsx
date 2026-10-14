import { renderToStaticMarkup } from "react-dom/server";

import { StatGrid, StatTile } from "./stat-tile";

it("stacks a tile's lines from the top, so a row's figures line up", () => {
  const html = renderToStaticMarkup(
    <StatGrid>
      <StatTile label="Total" note="Valuado en pesos">
        $ 1
      </StatTile>
      <StatTile label="Efectivo">$ 2</StatTile>
    </StatGrid>,
  );
  expect(html).toContain("<dl");
  expect(html.match(/content-start/g)).toHaveLength(2);
  expect(html).toMatch(/<dt[^>]*>Total<\/dt>/);
  expect(html).toContain("Valuado en pesos");
});
