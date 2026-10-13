import { renderToStaticMarkup } from "react-dom/server";

import { NOT_ADVICE, type ChatMessage } from "@/lib/assistant/chat";

import { ChatTranscript } from "./chat-transcript";

const render = (
  messages: ChatMessage[],
  waiting: string | null = null,
  questionsLeft = 30,
) =>
  renderToStaticMarkup(
    <ChatTranscript
      messages={messages}
      arrivedId={null}
      waiting={waiting}
      suggestions={["¿Cuánto debo?"]}
      questionsLeft={questionsLeft}
      disclaimerId="d"
      onAsk={() => {}}
    />,
  );

it("offers its questions while empty, with the quota and the notice", () => {
  const html = render([]);
  expect(html).toContain("¿Cuánto debo?");
  expect(html).toContain(NOT_ADVICE);
  expect(html).toContain("Te quedan 30 de 30 consultas este mes");
});

it("shows the question in a bubble and the answer without one, then the notice", () => {
  const html = render([
    { id: "q", role: "user", text: "¿Cuánto debo?" },
    {
      id: "a",
      role: "assistant",
      text: "Debés $ 100.",
      charts: [],
      table: null,
      sources: ["Deudas"],
      asOf: "2026-10-13",
      rate: null,
    },
  ]);
  expect(html).toMatch(
    /bg-primary[^"]*rounded-lg p-2[^>]*><span class="sr-only">Vos: <\/span>¿Cuánto debo\?/,
  );
  expect(html).toContain("Debés $ 100.");
  expect(html).not.toContain("¿Cuánto debo?</button>");
  expect(html.indexOf(NOT_ADVICE)).toBeGreaterThan(html.indexOf("Debés"));
});

it("disables its questions once the month's are used", () => {
  expect(render([], null, 0)).toMatch(/<button[^>]*disabled/);
});
