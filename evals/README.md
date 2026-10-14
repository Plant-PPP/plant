# Evals

Evals for document extraction and for the assistant. They arrive with the "Carga con IA" and "Asistente" stages.

The set of test documents and their expected answers does **not** enter the repo, because they are real documents. The evals read them from a private bucket or from `evals/local-docs/`, which is in `.gitignore`. The fixtures that do live here are made up.

## Extraction

The extraction eval reads every test document through the real upload source: two Gemini readings and a tiebreak for PDFs and pictures, the column mapper for spreadsheets. It scores each reading against the holdings written by hand next to the document.

- **The documents** go in `evals/local-docs/` (ignored by git): a PDF, picture, CSV or Excel file, plus `<file name>.expected.json` beside it, for example `iol-2026-09.pdf.expected.json`:

  ```json
  {
    "rows": [{ "symbol": "AL30", "quantity": "1000", "currency": "USD" }],
    "totals": [{ "currency": "ARS", "amount": "1500000.50" }]
  }
  ```

  Quantities and amounts are plain decimals with a dot; `totals` lists only the totals the document prints. The file name's first word is used as the institution.

- **The scoring** is in `apps/web/src/lib/imports/evals/score.ts`, and its tests run in `pnpm test`. A row is right when the reading lists its symbol and currency with the same units. It is flagged when the reading lists it with other units but marks it low, for the user to check. Anything else is wrong. A total is right when the reading prints the same amount.
- **The bar** is the stage's: 95% of the rows right or flagged, and every printed total right.

```bash
GOOGLE_GENERATIVE_AI_API_KEY=... pnpm --filter @plant/web eval:extraction
```

It also reads `apps/web/.env.local` when present. It prints counts per document, never their figures, and fails under the bar. Without a key or without documents it is skipped. Run it again whenever a prompt or a model changes. It is not part of `pnpm test` or CI.

## The assistant

The assistant's evals live in `apps/web`, next to the code they run, since this package cannot import the app:

- `apps/web/src/lib/assistant/evals/questions.ts`: 30 questions asking what to buy, sell or do with money, each marked as answered by the fixed answer (`isAdvice`) or left to the model, and 10 questions about the user's data, each with the tools it needs, its unit, the currency of its amounts and the chart it must carry, if any.
- `apps/web/src/lib/assistant/evals/questions.test.ts`: runs in `pnpm test`, with no model. It checks which questions `isAdvice` catches and that the fixed answer says Plant does not recommend.
- `apps/web/src/lib/ai/assistant/evals/assistant.eval.ts`: runs every question through the real chat (`runAssistantTurn`, Claude Haiku) over the prototype's data. A provocative question must get no recommendation, judged by a second Haiku call with a strict rubric; a data question must call its tools, write only figures some tool answered (within the rounding written) in the right currency, carry the dollar of its unit, and carry a chart only when asked, with the points the tool drew. A 31st question in a month gets the quota answer. It prints a table and fails if any check does.

```bash
ANTHROPIC_API_KEY=... pnpm --filter @plant/web eval:assistant
```

It also reads `apps/web/.env.local` when present. Without a key every case is skipped. It is not part of `pnpm test` or CI: it calls the model about 80 times, a few cents with Haiku.
