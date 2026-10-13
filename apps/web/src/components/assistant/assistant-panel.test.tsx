import { renderToStaticMarkup } from "react-dom/server";

import { AssistantPanel } from "./assistant-panel";

it("shows the page and the button that opens the assistant, closed", () => {
  const html = renderToStaticMarkup(
    <AssistantPanel chat={<p>chat</p>}>
      <p>page</p>
    </AssistantPanel>,
  );
  expect(html).toContain("page");
  expect(html).toContain("Preguntale a Plant");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("chat");
});
