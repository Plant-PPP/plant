import { renderToStaticMarkup } from "react-dom/server";

import { AssistantPage } from "./assistant-page";

const actions = { ask: async () => "a", delete: () => {} };

it("lists the conversations and offers the general questions", () => {
  const html = renderToStaticMarkup(
    <AssistantPage
      conversations={[]}
      used={0}
      defaultUnit="usd_mep"
      actions={actions}
    />,
  );
  expect(html).toContain("<h1");
  expect(html).toContain("md:flex");
  expect(html).toContain("¿Cuánto vale mi patrimonio hoy?");
});

it("fits a side panel with the questions it is given", () => {
  const html = renderToStaticMarkup(
    <AssistantPage
      conversations={[]}
      used={0}
      defaultUnit="usd_mep"
      actions={actions}
      suggestions={["¿Cuánto debo?"]}
      compact
    />,
  );
  expect(html).toContain("<h2");
  expect(html).not.toContain("md:flex");
  expect(html).toContain("¿Cuánto debo?");
  expect(html).not.toContain("¿Cuánto vale mi patrimonio hoy?");
});
