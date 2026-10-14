import type { AiCostInsert } from "@plant/shared";
import { SourceError } from "@plant/sources";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@ai-sdk/google", () => ({ google: jest.fn() }));

import { captureServerLog } from "@/lib/log/capture-server-log";

import {
  documentExtractor,
  READERS,
  TIEBREAK_MODEL,
} from "./document-extractor";

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
    lastAttempt: false,
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
  expect(read).toEqual({
    reader: "document",
    mapping: "none",
    skippedRows: 0,
    disputes: 0,
  });
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
  // Two readings that agree need no third.
  expect(record.mock.calls.map(([row]) => row.model_id).sort()).toEqual(
    [...READERS].sort(),
  );
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: USER,
      cost_type: "import_extraction",
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

const row = (symbol: string, quantity: string, extra = {}) => ({
  symbol,
  quantity,
  price: null,
  value: null,
  currency: "ARS",
  confidence: "high",
  page: 1,
  ...extra,
});

const reading = (rows: object[], documentDate = "2026-09-30") =>
  JSON.stringify({ documentDate, rows, totals: [] });

// One mock per model id, so each reader answers its own reading.
const byModel = (answers: Record<string, string>) => {
  const models = Object.fromEntries(
    Object.entries(answers).map(([id, text]) => [id, answering(text)]),
  );
  return {
    models,
    run: () =>
      documentExtractor({
        record,
        model: (id) => models[id]!,
      })({
        bytes: BYTES,
        mimeType: "application/pdf",
        userId: USER,
        importId: "i1",
        institution: "IOL",
        lastAttempt: false,
      }),
  };
};

it("asks a third model only about what the two readers disagree on", async () => {
  const [lite35, lite31] = READERS;
  expect(TIEBREAK_MODEL).toBe(lite35);
  // The tiebreak shares a model id with the first reader, so the first answer
  // is the reading and the second the tiebreak.
  let calls = 0;
  const first = reading([row("AAPL", "5"), row("GGAL", "100")]);
  const tiebreak = reading([row("GGAL", "100")]);
  const shared = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: calls++ === 0 ? first : tiebreak }],
      finishReason: { unified: "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
  const second = answering(reading([row("AAPL", "5"), row("GGAL", "1000")]));
  const { draft, read } = await documentExtractor({
    record,
    model: (id) => (id === lite31 ? second : shared),
  })({
    bytes: BYTES,
    mimeType: "application/pdf",
    userId: USER,
    importId: "i1",
    institution: "IOL",
    lastAttempt: false,
  });
  expect(read.disputes).toBe(1);
  expect(draft.rows.map((r) => [r.symbol, r.quantity])).toEqual([
    ["AAPL", "5"],
    ["GGAL", "100"],
  ]);
  expect(record).toHaveBeenCalledTimes(3);
  const ask = shared.doGenerateCalls[1]!.prompt.flatMap(
    (message): { type: string; text?: string }[] =>
      Array.isArray(message.content) ? message.content : [],
  ).find((part) => part.type === "text");
  expect(ask?.text).toContain("<symbol>GGAL</symbol> (ARS)");
  expect(ask?.text).not.toContain("AAPL");
});

it("keeps the other reading, every row low, when one reader fails", async () => {
  const [, lite31] = READERS;
  const { run } = byModel({
    [READERS[0]]: reading([row("AAPL", "5")]),
    [lite31]: "not json",
  });
  const { draft } = await run();
  expect(draft.rows).toEqual([
    expect.objectContaining({ symbol: "AAPL", confidence: "low" }),
  ]);
});

it("fails the reading when both readers fail", async () => {
  const { run } = byModel({
    [READERS[0]]: "not json",
    [READERS[1]]: "not json",
  });
  await expect(run()).rejects.toMatchObject({ code: "unreadable" });
});

it("lets the step retry when the tiebreak's provider is down", async () => {
  const [lite35, lite31] = READERS;
  let calls = 0;
  const shared = new MockLanguageModelV3({
    doGenerate: async () => {
      if (calls++ === 0) {
        return {
          content: [{ type: "text", text: reading([row("GGAL", "100")]) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      }
      throw new APICallError({
        message: "overloaded",
        url: "https://x",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    },
  });
  expect(TIEBREAK_MODEL).toBe(lite35);
  const second = answering(reading([row("GGAL", "1000")]));
  const error = await documentExtractor({
    record,
    model: (id) => (id === lite31 ? second : shared),
  })({
    bytes: BYTES,
    mimeType: "application/pdf",
    userId: USER,
    importId: "i1",
    institution: "IOL",
    lastAttempt: false,
  }).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: "extraction_failed", retryable: true });
});

it("settles on the two readings when the tiebreak fails on the last attempt", async () => {
  const [, lite31] = READERS;
  let calls = 0;
  const shared = new MockLanguageModelV3({
    doGenerate: async () => {
      if (calls++ === 0) {
        return {
          content: [{ type: "text", text: reading([row("GGAL", "100")]) }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      }
      throw new APICallError({
        message: "overloaded",
        url: "https://x",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
      });
    },
  });
  const second = answering(reading([row("GGAL", "1000")]));
  const { draft } = await documentExtractor({
    record,
    model: (id) => (id === lite31 ? second : shared),
  })({
    bytes: BYTES,
    mimeType: "application/pdf",
    userId: USER,
    importId: "i1",
    institution: "IOL",
    lastAttempt: true,
  });
  expect(draft.rows).toEqual([
    expect.objectContaining({
      symbol: "GGAL",
      quantity: "100",
      confidence: "low",
    }),
  ]);
});

it("lets a reading that timed out be retried", async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
  });
  const error = await extract(model).catch((e: unknown) => e);
  expect(error).toMatchObject({ code: "extraction_failed", retryable: true });
});
