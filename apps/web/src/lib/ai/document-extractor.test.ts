import type { AiCostInsert } from "@plant/shared";
import { SourceError } from "@plant/sources";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@ai-sdk/google", () => ({ google: jest.fn() }));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { documentExtractor, EXTRACTION_MODEL } from "./document-extractor";

const USER = "a0000000-0000-4000-8000-00000000000a";
const BYTES = new TextEncoder().encode("%PDF-1.7");

const usage = {
  inputTokens: {
    total: 3000,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 400, text: undefined, reasoning: undefined },
};

const answering = (text: string) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });

let record: jest.Mock<Promise<void>, [AiCostInsert]>;
beforeEach(() => {
  captureServerLog();
  record = jest.fn<Promise<void>, [AiCostInsert]>(async () => {});
});

const extract = (model: MockLanguageModelV3, mimeType = "application/pdf") =>
  documentExtractor({ record, model: () => model })({
    bytes: BYTES,
    mimeType,
    userId: USER,
    importId: "i1",
    institution: "IOL",
  });

it("reads the holdings and costs the call to the user", async () => {
  const model = answering(
    JSON.stringify({
      documentDate: "2026-09-30",
      rows: [
        {
          symbol: "AAPL",
          quantity: "5",
          price: "18000.5",
          value: "90002.5",
          currency: "ARS",
          confidence: "high",
          page: 1,
        },
        {
          symbol: "GD30",
          quantity: "1.000,5",
          price: null,
          value: null,
          currency: "USD",
          confidence: "low",
          page: 0,
        },
        {
          symbol: "BTC",
          quantity: "0.05",
          price: "",
          value: "",
          currency: "USD",
          confidence: "medium",
          page: null,
        },
      ],
      totals: [
        { currency: "ARS", amount: " 90002.50 " },
        { currency: "USD", amount: "abc" },
      ],
    }),
  );
  const { draft, read } = await extract(model);
  expect(read).toEqual({ reader: "document", mapping: "none" });
  expect(draft).toEqual({
    documentDate: "2026-09-30",
    rows: [
      {
        symbol: "AAPL",
        quantity: "5",
        price: "18000.5",
        value: "90002.5",
        currency: "ARS",
        confidence: "high",
        page: 1,
      },
      // The row whose quantity is not a plain decimal is left out.
      {
        symbol: "BTC",
        quantity: "0.05",
        price: null,
        value: null,
        currency: "USD",
        confidence: "medium",
        page: null,
      },
    ],
    // Totals that are not all decimals are left out.
    totals: [],
  });
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: USER,
      cost_type: "import_extraction",
      model_id: EXTRACTION_MODEL,
    }),
  );
  const [call] = model.doGenerateCalls;
  const file = call!.prompt
    .flatMap((message): { type: string }[] =>
      Array.isArray(message.content) ? message.content : [],
    )
    .find((part) => part.type === "file");
  expect(file).toMatchObject({ mediaType: "application/pdf" });
});

it("drops a date that is not one", async () => {
  const { draft } = await extract(
    answering(
      JSON.stringify({ documentDate: "30/09/2026", rows: [], totals: [] }),
    ),
  );
  expect(draft.documentDate).toBeNull();
});

it("keeps the totals the statement prints, one per currency", async () => {
  const { draft } = await extract(
    answering(
      JSON.stringify({
        documentDate: null,
        rows: [],
        totals: [
          { currency: "ARS", amount: "1500.25" },
          { currency: "USD", amount: "120" },
        ],
      }),
    ),
  );
  expect(draft.totals).toEqual([
    { currency: "ARS", amount: "1500.25" },
    { currency: "USD", amount: "120" },
  ]);
});

it("calls an answer that is not the draft unreadable", async () => {
  const error = await extract(answering("not json")).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SourceError);
  expect(error).toMatchObject({ code: "unreadable", retryable: false });
});

it("lets a provider that is down be retried", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw new APICallError({
        message: "overloaded",
        url: "https://x",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    },
  });
  const error = await extract(model).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: "extraction_failed", retryable: true });
});
