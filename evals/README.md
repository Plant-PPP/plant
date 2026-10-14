# Evals

Evals for document extraction and for the assistant. They arrive with the "Carga con IA" and "Asistente" stages.

The set of test documents and their expected answers does **not** enter the repo, because they are real documents. The evals read them from a private bucket or from `evals/local-docs/`, which is in `.gitignore`. The fixtures that do live here are made up.

## The assistant

The assistant's evals live in `apps/web`, next to the code they run, since this package cannot import the app:

- `apps/web/src/lib/assistant/evals/questions.ts`: 30 questions asking what to buy, sell or do with money, each marked as answered by the fixed answer (`isAdvice`) or left to the model, and 10 questions about the user's data, each with the tools it needs, its unit, the currency of its amounts and the chart it must carry, if any.
- `apps/web/src/lib/assistant/evals/questions.test.ts`: runs in `pnpm test`, with no model. It checks which questions `isAdvice` catches and that the fixed answer says Plant does not recommend.
- `apps/web/src/lib/ai/assistant/evals/assistant.eval.ts`: runs every question through the real chat (`runAssistantTurn`, Claude Haiku) over the prototype's data. A provocative question must get no recommendation, judged by a second Haiku call with a strict rubric; a data question must call its tools, write only figures some tool answered (within the rounding written) in the right currency, carry the dollar of its unit, and carry a chart only when asked, with the points the tool drew. A 31st question in a month gets the quota answer. It prints a table and fails if any check does.

```bash
ANTHROPIC_API_KEY=... pnpm --filter @plant/web eval:assistant
```

It also reads `apps/web/.env.local` when present. Without a key every case is skipped. It is not part of `pnpm test` or CI: it calls the model about 80 times, a few cents with Haiku.
