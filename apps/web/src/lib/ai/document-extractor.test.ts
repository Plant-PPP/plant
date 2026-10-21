import type { AiCostInsert } from "@plant/shared";
import { type SourceReading, SourceError } from "@plant/sources";
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

// The holdings a reading yields, failing the test when it yields operations.
const holdings = (reading: SourceReading) => {
  if (!("draft" in reading)) throw new Error("read as operations");
  return reading;
};

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
      kind: "account_statement",
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
      operations: [],
      totals: [
        { currency: "ARS", amount: " 90002.50 " },
        { currency: "USD", amount: "abc" },
      ],
    }),
  );
  const { draft, read } = holdings(await extract(model));
  expect(read).toEqual({
    reader: "document",
    mapping: "none",
    skippedRows: 0,
    disputes: 0,
    documentKind: "account_statement",
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
  const { draft } = holdings(
    await extract(
      answering(
        JSON.stringify({
          kind: "account_statement",
          documentDate: "30/09/2026",
          rows: [],
          operations: [],
          totals: [],
        }),
      ),
    ),
  );
  expect(draft.documentDate).toBeNull();
});

const screenshotOf = (row: Record<string, unknown>) =>
  answering(
    JSON.stringify({
      kind: "screenshot",
      documentDate: null,
      rows: [{ currency: "USD", confidence: "high", page: 1, ...row }],
      operations: [],
      totals: [],
    }),
  );

it("keeps a row whose account and cost the model answers as null", async () => {
  const { draft } = holdings(
    await extract(
      screenshotOf({
        symbol: "ETH",
        quantity: "37.23938885",
        price: "2489.63",
        value: "92691.52",
        account: null,
        cost: null,
      }),
    ),
  );
  expect(draft.rows).toEqual([
    expect.objectContaining({ symbol: "ETH", quantity: "37.23938885" }),
  ]);
  expect(draft.rows[0]).not.toHaveProperty("account");
});

it("reads a balance in a currency Plant keeps as cash in it", async () => {
  const { draft } = holdings(
    await extract(
      screenshotOf({
        symbol: "EUR",
        quantity: "22.39",
        price: null,
        value: "25.15",
      }),
    ),
  );
  expect(draft.rows).toEqual([
    expect.objectContaining({
      symbol: "EUR",
      quantity: "22.39",
      assetClass: "cash",
      currency: "EUR",
    }),
  ]);
});

it("keeps the totals the statement prints, one per currency", async () => {
  const { draft } = holdings(
    await extract(
      answering(
        JSON.stringify({
          kind: "account_statement",
          documentDate: null,
          rows: [],
          operations: [],
          totals: [
            { currency: "ARS", amount: "1500.25" },
            { currency: "USD", amount: "120" },
          ],
        }),
      ),
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

const reading = (
  rows: object[],
  documentDate = "2026-09-30",
  kind = "account_statement",
) => JSON.stringify({ kind, documentDate, rows, operations: [], totals: [] });

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
  const { draft, read } = holdings(
    await documentExtractor({
      record,
      model: (id) => (id === lite31 ? second : shared),
    })({
      bytes: BYTES,
      mimeType: "application/pdf",
      userId: USER,
      importId: "i1",
      institution: "IOL",
      lastAttempt: false,
    }),
  );
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
  const { draft } = holdings(await run());
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
  const { draft } = holdings(
    await documentExtractor({
      record,
      model: (id) => (id === lite31 ? second : shared),
    })({
      bytes: BYTES,
      mimeType: "application/pdf",
      userId: USER,
      importId: "i1",
      institution: "IOL",
      lastAttempt: true,
    }),
  );
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

it("lets the step retry when one reader's provider is down", async () => {
  const [, lite31] = READERS;
  const down = new MockLanguageModelV3({
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
  const input = {
    bytes: BYTES,
    mimeType: "application/pdf",
    userId: USER,
    importId: "i1",
    institution: "IOL",
  };
  const extractor = documentExtractor({
    record,
    model: (id) =>
      id === lite31 ? down : answering(reading([row("AAPL", "5")])),
  });
  await expect(
    extractor({ ...input, lastAttempt: false }),
  ).rejects.toMatchObject({
    code: "extraction_failed",
    retryable: true,
  });
  // With no retry left, the other reading stands, every row low.
  const { draft } = holdings(await extractor({ ...input, lastAttempt: true }));
  expect(draft.rows).toEqual([
    expect.objectContaining({ symbol: "AAPL", confidence: "low" }),
  ]);
});

const cardStatement = (balance: string) =>
  JSON.stringify({
    kind: "card_statement",
    documentDate: null,
    rows: [row("AAPL", "5")],
    operations: [],
    totals: [],
    debts: [
      {
        label: " Visa ",
        lender: "Galicia",
        currency: "ARS",
        balance,
        minimumPayment: "25000",
        dueDate: "2026-10-20",
        confidence: "high",
        page: 1,
      },
      {
        label: "Visa",
        lender: null,
        currency: "USD",
        balance: "not a number",
        minimumPayment: null,
        dueDate: "20/10/2026",
        confidence: "high",
        page: 1,
      },
    ],
  });

it("reads a document both readers call a card statement as its debts", async () => {
  const { run } = byModel({
    [READERS[0]]: cardStatement("250000.50"),
    [READERS[1]]: cardStatement("205000.50"),
  });
  const reading = await run();
  expect(reading.read.documentKind).toBe("card_statement");
  if (!("debts" in reading)) throw new Error("not read as debts");
  // A balance they disagree on is left for the review; a debt with nothing
  // that reads is left out.
  expect(reading.debts).toEqual([
    {
      label: "Visa",
      lender: "Galicia",
      currency: "ARS",
      balance: null,
      minimumPayment: "25000",
      dueDate: "2026-10-20",
      confidence: "low",
      page: 1,
    },
  ]);
});

it("counts the debts two readings make past the limit as skipped", async () => {
  const statement = (ars: number, usd: number) =>
    JSON.stringify({
      kind: "card_statement",
      documentDate: null,
      rows: [],
      operations: [],
      totals: [],
      debts: [
        ...Array.from({ length: ars }, () => ["ARS", "1000"]),
        ...Array.from({ length: usd }, () => ["USD", "10"]),
      ].map(([currency, balance]) => ({
        label: "Visa",
        lender: "Galicia",
        currency,
        balance,
        minimumPayment: null,
        dueDate: null,
        confidence: "high",
        page: 1,
      })),
    });
  const { run } = byModel({
    [READERS[0]]: statement(6, 4),
    [READERS[1]]: statement(4, 6),
  });
  const reading = await run();
  if (!("debts" in reading)) throw new Error("not read as debts");
  expect(reading.debts).toHaveLength(10);
  expect(reading.read.skippedRows).toBe(2);
});

it("keeps the holdings when the readers disagree on what the document is", async () => {
  const { run } = byModel({
    [READERS[0]]: reading([row("AAPL", "5")], "2026-09-30", "card_statement"),
    [READERS[1]]: reading([row("AAPL", "5")]),
  });
  const { draft, read } = holdings(await run());
  expect(read.documentKind).toBeNull();
  expect(draft.rows).toHaveLength(1);
});

const operation = (extra: object = {}) => ({
  date: "2026-09-01",
  kind: "purchase",
  symbol: "GGAL",
  quantity: "100",
  price: "5000",
  amount: null,
  charges: "25.5",
  reference: "123",
  currency: "ARS",
  confidence: "high",
  page: 1,
  ...extra,
});

const operationsReading = (operations: object[], kind = "trade_ticket") =>
  JSON.stringify({
    kind,
    documentDate: null,
    rows: [],
    operations,
    totals: [],
  });

it("reads a document both readers call a ticket as operations, with no tiebreak", async () => {
  const { run } = byModel({
    [READERS[0]]: operationsReading([operation()]),
    [READERS[1]]: operationsReading([
      operation({ symbol: null, quantity: "1000" }),
    ]),
  });
  const reading = await run();
  expect(reading.read.documentKind).toBe("trade_ticket");
  if (!("operations" in reading)) throw new Error("read as holdings");
  // The readings name the instrument differently and are paired by the
  // operation's number: one operation, its name and units for the user.
  expect(reading.operations).toEqual([
    expect.objectContaining({
      symbol: null,
      quantity: null,
      reference: "123",
      confidence: "low",
    }),
  ]);
  expect(record).toHaveBeenCalledTimes(2);
});

it("leaves a field the readers disagree on for the review", async () => {
  const { run } = byModel({
    [READERS[0]]: operationsReading([operation()], "operations_list"),
    [READERS[1]]: operationsReading(
      [operation({ quantity: "1000", charges: "25.50" })],
      "operations_list",
    ),
  });
  const reading = await run();
  if (!("operations" in reading)) throw new Error("read as holdings");
  expect(reading.operations).toEqual([
    {
      date: "2026-09-01",
      kind: "purchase",
      symbol: "GGAL",
      quantity: null,
      price: "5000",
      amount: null,
      charges: "25.5",
      reference: "123",
      currency: "ARS",
      confidence: "low",
      page: 1,
    },
  ]);
});

it("keeps what an operation's reading cannot parse as missing, not the row", async () => {
  const { run } = byModel({
    [READERS[0]]: operationsReading([
      operation({ quantity: "1.000,5", date: "01/09/2026" }),
    ]),
    [READERS[1]]: operationsReading([
      operation({ quantity: "1.000,5", date: "01/09/2026" }),
    ]),
  });
  const reading = await run();
  if (!("operations" in reading)) throw new Error("read as holdings");
  expect(reading.operations[0]).toMatchObject({
    quantity: null,
    date: null,
    symbol: "GGAL",
  });
});

it("reads operations when one reader calls the document a ticket and the other a list", async () => {
  const { run } = byModel({
    [READERS[0]]: operationsReading([operation()], "trade_ticket"),
    [READERS[1]]: operationsReading([operation()], "operations_list"),
  });
  const reading = await run();
  if (!("operations" in reading)) throw new Error("read as holdings");
  expect(reading.operations).toHaveLength(1);
});

it("keeps a lone reader's operations, every one low, when the other fails", async () => {
  const { run } = byModel({
    [READERS[0]]: operationsReading([operation()]),
    [READERS[1]]: "not json",
  });
  const reading = await run();
  if (!("operations" in reading)) throw new Error("read as holdings");
  expect(reading.operations).toEqual([
    expect.objectContaining({ symbol: "GGAL", confidence: "low" }),
  ]);
});

it("logs a failed model call with the import it was reading", async () => {
  const lines = captureServerLog();
  const model = new MockLanguageModelV3({
    doGenerate: () => Promise.reject(new Error("down")),
  });
  await extract(model).catch(() => undefined);
  expect(lines).toContainEqual(
    expect.objectContaining({
      event: "ai.call_failed",
      "plant.import.id": "i1",
    }),
  );
});
