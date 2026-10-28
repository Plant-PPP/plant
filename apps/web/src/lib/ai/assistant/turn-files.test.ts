jest.mock("server-only", () => ({}), { virtual: true });

import type { LanguageModelMiddleware } from "ai";
import { MockLanguageModelV3 } from "ai/test";

import type { AssistantStore, StoredMessage } from "@/lib/assistant/store";

import { runAssistantTurn, type TurnReport } from "./turn";

type Wrap = Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0];
type StreamResult = Awaited<ReturnType<Wrap["doStream"]>>;
type LanguageModelV3StreamPart =
  StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const FOLDER = `${USER}/assistant/${CONVERSATION}`;
// "png!" in base64.
const DATA = "cG5nIQ==";

const answered = () =>
  new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: "Listo." },
        { type: "text-end", id: "t" },
        {
          type: "finish",
          usage: {
            inputTokens: {
              total: 10,
              noCache: 10,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          finishReason: { unified: "stop", raw: undefined },
        },
      ] as LanguageModelV3StreamPart[]) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });

// The session's client, as far as Storage: what it was asked to store and
// read, and the files it holds.
function storageWith(files: Record<string, string> = {}) {
  const uploaded: { path: string; type?: string }[] = [];
  const downloaded: string[] = [];
  const bucket = {
    upload: async (
      path: string,
      _body: unknown,
      options: { contentType?: string },
    ) => {
      uploaded.push({ path, type: options.contentType });
      return { data: { path }, error: null };
    },
    download: async (path: string) => {
      downloaded.push(path);
      return path in files
        ? { data: new Blob([Buffer.from(files[path]!, "base64")]), error: null }
        : { data: null, error: { status: 400, statusCode: "404" } };
    },
  };
  return {
    client: { storage: { from: () => bucket } },
    uploaded,
    downloaded,
  };
}

async function ask({
  client,
  history = [],
  attachments = [],
}: {
  client: unknown;
  history?: StoredMessage[];
  attachments?: { filename: string; mediaType: string; data: string }[];
}) {
  const saved: StoredMessage[][] = [];
  const prompts: unknown[] = [];
  const reports: Parameters<TurnReport>[0][] = [];
  const store: AssistantStore = {
    reserveQuestion: async () => "ok",
    conversation: async () => null,
    startConversation: async () => {},
    history: async () => history,
    saveTurn: async (_user, { messages }) => {
      saved.push(messages);
    },
  };
  const response = await runAssistantTurn({
    client: client as never,
    store,
    record: async () => {},
    model: () =>
      new MockLanguageModelV3({
        doStream: async (options) => {
          prompts.push(options.prompt);
          return { stream: answered() };
        },
      }),
    context: {
      userId: USER,
      requestId: undefined,
      page: "/assistant",
      params: {},
    },
    conversationId: CONVERSATION,
    question: "La primera",
    attachments,
    unit: "usd_mep",
    today: "2026-10-13",
    report: (report) => {
      reports.push(report);
    },
  });
  await response.text();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    saved,
    prompt: prompts[0] as { role: string; content: unknown }[],
    reports,
  };
}

const env = process.env.ANTHROPIC_API_KEY;
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});
afterAll(() => {
  process.env.ANTHROPIC_API_KEY = env;
});

// A question that kept a screenshot, and the answer that asked about it.
const earlier = (path = `${FOLDER}/msg-old-0`): StoredMessage[] => [
  {
    id: "msg-old",
    role: "user",
    parts: [{ type: "text", text: "¿Qué ves acá?" }],
    metadata: {
      attachments: [{ filename: "log.png", mediaType: "image/png", path }],
    },
  },
  {
    id: "msg-asked",
    role: "assistant",
    parts: [
      {
        type: "tool-askUser",
        toolCallId: "q1",
        state: "output-available",
        input: {},
        output: {
          question: { text: "¿Es tu cuenta de BTC?", options: ["Sí", "No"] },
        },
      },
    ],
    metadata: null,
  },
];

it("keeps a question's files in the user's folder, and names them on the question", async () => {
  const { client, uploaded } = storageWith();
  const { saved, reports } = await ask({
    client,
    attachments: [{ filename: "log.png", mediaType: "image/png", data: DATA }],
  });
  const [question] = saved[0]!;
  const path = uploaded[0]!.path;
  expect(path).toMatch(new RegExp(`^${FOLDER}/msg[^/]+-0$`));
  expect(path).toBe(`${FOLDER}/${question!.id}-0`);
  expect(uploaded[0]!.type).toBe("image/png");
  expect(question!.metadata).toEqual({
    attachments: [{ filename: "log.png", mediaType: "image/png", path }],
  });
  expect(reports).toContainEqual({ attachmentsKept: 1, attachmentsFailed: 0 });
});

it("reads the latest kept files again with the question the answer asked", async () => {
  const { client, downloaded } = storageWith({ [`${FOLDER}/msg-old-0`]: DATA });
  const { prompt, reports } = await ask({ client, history: earlier() });
  expect(downloaded).toEqual([`${FOLDER}/msg-old-0`]);
  const [, user, assistant, current] = prompt;
  expect(user!.content).toEqual([
    expect.objectContaining({ type: "text" }),
    expect.objectContaining({ type: "file", mediaType: "image/png" }),
  ]);
  expect(JSON.stringify(assistant!.content)).toContain(
    'Preguntaste: \\"¿Es tu cuenta de BTC?\\". Opciones: Sí / No.',
  );
  // The current question ends what every step sends alike, cached.
  expect(current!.content).toEqual([
    expect.objectContaining({
      type: "text",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    }),
  ]);
  expect(reports).toContainEqual({
    filesReplayed: 1,
    filesMissing: 0,
    filesFailed: 0,
  });
});

it("names files no longer there, and never reads a path that is not the user's", async () => {
  const gone = storageWith();
  const missing = await ask({ client: gone.client, history: earlier() });
  expect(JSON.stringify(missing.prompt[1]!.content)).toContain(
    "(archivos: log.png; ya no están disponibles)",
  );
  expect(missing.reports).toContainEqual({
    filesReplayed: 0,
    filesMissing: 1,
    filesFailed: 0,
  });

  const other = storageWith({ "someone/assistant/x/y": DATA });
  await ask({
    client: other.client,
    history: earlier("someone/assistant/x/y"),
  });
  expect(other.downloaded).toEqual([]);
});
