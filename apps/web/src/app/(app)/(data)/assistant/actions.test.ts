const requestHeaders = new Headers();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => requestHeaders }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "user-1" }),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/assistant/conversations", () => ({
  conversationMessages: async () => [],
  deleteConversation: async () => {},
}));
jest.mock("@/lib/assistant/pins", () => ({
  ...jest.requireActual("@/lib/assistant/pins"),
  pinChart: async () => "pinned",
  unpinChart: async () => true,
}));

import { captureServerLog } from "@/lib/log/capture-server-log";
import {
  deleteConversation,
  loadConversation,
  pinChart,
  unpinChart,
} from "./actions";

const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const ID = "0b7c8d2e-1f3a-4b5c-9d6e-7f8a9b0c1d2e";

let lines: Record<string, unknown>[];

beforeEach(() => {
  requestHeaders.set("x-request-id", REQUEST_ID);
  lines = captureServerLog();
});

afterEach(() => jest.restoreAllMocks());

it.each([
  ["load", () => loadConversation(ID)],
  ["delete", () => deleteConversation(ID)],
  ["unpin", () => unpinChart(ID)],
])("stamps the request id on the %s line", async (_action, run) => {
  await run();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ "plant.request_id": REQUEST_ID });
});

it("stamps the request id on the pin line", async () => {
  await pinChart({ topic: "allocation", portfolioId: null });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    event: "assistant.pin",
    "plant.request_id": REQUEST_ID,
  });
});
