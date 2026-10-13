import { renderToStaticMarkup } from "react-dom/server";

import { AssistantPage } from "./assistant-page";

const actions = { ask: async () => "a", delete: () => {} };

it("is a page with the general questions and the history select", () => {
  const html = renderToStaticMarkup(
    <AssistantPage
      conversations={[]}
      used={0}
      defaultUnit="usd_mep"
      actions={actions}
    />,
  );
  expect(html).toContain("<h1");
  expect(html).toContain("¿Cuánto vale mi patrimonio hoy?");
  expect(html).toContain('aria-label="Conversaciones"');
});
