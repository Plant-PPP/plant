import { toChatMessages } from "./messages-view";

it("shows a question's text and an answer's text with what it read", () => {
  expect(
    toChatMessages([
      {
        id: "q",
        role: "user",
        parts: [{ type: "text", text: "¿Cuánto debo?" }],
      },
      {
        id: "a",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "tool-getPortfolioSummary", output: { assets: "1" } },
          { type: "text", text: "Debés " },
          { type: "text", text: "US$ 100." },
        ],
        metadata: {
          asOf: "2026-10-13",
          rate: { label: "MEP", sell: "1225.50" },
          sources: ["Deudas", 3],
          complete: true,
        },
      },
    ]),
  ).toEqual([
    { id: "q", role: "user", text: "¿Cuánto debo?" },
    {
      id: "a",
      role: "assistant",
      text: "Debés US$ 100.",
      charts: [],
      table: null,
      sources: ["Deudas"],
      asOf: "2026-10-13",
      rate: { label: "MEP", sell: "1225.50" },
    },
  ]);
});

it("leaves an answer still streaming without a day, and drops other roles", () => {
  const [answer] = toChatMessages([
    { id: "a", role: "assistant", parts: [{ type: "text", text: "Tu" }] },
    { id: "s", role: "system", parts: [{ type: "text", text: "x" }] },
  ]);
  expect(answer).toMatchObject({ asOf: "", rate: null, sources: [] });
});

it("shows the charts kept with an answer, leaving out what is not one", () => {
  const chart = {
    kind: "bars",
    title: "Lo que debés",
    unit: "ars",
    points: [
      { label: "Hipoteca", value: "100" },
      { label: 3, value: "1" },
    ],
  };
  const [answer] = toChatMessages([
    {
      id: "a",
      role: "assistant",
      parts: [{ type: "text", text: "Debés $ 100." }],
      metadata: {
        asOf: "2026-10-13",
        rate: null,
        sources: [],
        complete: true,
        charts: [chart, { kind: "pie", title: "x", unit: "ars", points: [] }],
      },
    },
  ]);
  expect(answer).toMatchObject({
    charts: [{ ...chart, points: [{ label: "Hipoteca", value: "100" }] }],
  });
});
