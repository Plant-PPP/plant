let pathname = "/debts";
jest.mock("next/navigation", () => ({ usePathname: () => pathname }));
jest.mock("@/components/assistant/assistant-panel", () => ({
  AssistantPanel: ({
    chat,
    children,
  }: {
    chat: React.ReactElement<{ suggestions: string[] }>;
    children: React.ReactNode;
  }) => (
    <div data-suggestions={chat.props.suggestions.join("|")}>{children}</div>
  ),
}));
jest.mock("./prototype-chat", () => ({ PrototypeChat: () => null }));

import { renderToStaticMarkup } from "react-dom/server";

import { PrototypeAssistantPanel } from "./prototype-assistant-panel";

it("puts the assistant beside a page, with that page's questions", () => {
  pathname = "/debts";
  const html = renderToStaticMarkup(
    <PrototypeAssistantPanel>page</PrototypeAssistantPanel>,
  );
  expect(html).toContain("¿Cuánto debo?");
  expect(html).toContain("page");
});

it("leaves Asistente's own page as it is", () => {
  pathname = "/assistant";
  expect(
    renderToStaticMarkup(
      <PrototypeAssistantPanel>page</PrototypeAssistantPanel>,
    ),
  ).toBe("page");
});
