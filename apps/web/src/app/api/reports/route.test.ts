import { captureServerLog } from "@/lib/log/capture-server-log";

const REQUEST_ID = "6a2f41a0-0b1c-4d2e-8f30-415263748596";

const post = async (
  body: string,
  {
    type = "application/json",
    request = REQUEST_ID,
    sender = "1.1.1.1",
  }: { type?: string; request?: string; sender?: string } = {},
) => {
  const { POST } = await import("./route");
  return POST(
    new Request(`http://localhost/api/reports?request=${request}`, {
      method: "POST",
      headers: { "content-type": type, "x-real-ip": sender },
      body,
    }),
  );
};

beforeEach(() => jest.resetModules());
afterEach(() => jest.restoreAllMocks());

it("logs a page's error with the page's request id, and answers 204", async () => {
  const lines = captureServerLog();
  const response = await post(
    JSON.stringify({ kind: "error", type: "TypeError", path: "/assets?x=1" }),
  );
  expect(response.status).toBe(204);
  expect(lines).toEqual([
    expect.objectContaining({
      event: "browser.error",
      level: "warn",
      "plant.request_id": REQUEST_ID,
      "plant.report.kind": "error",
      "error.type": "TypeError",
      "url.path": "/assets",
    }),
  ]);
});

it("keeps the request id only when it is a whole UUID", async () => {
  const lines = captureServerLog();
  await post(JSON.stringify({ kind: "error" }), { request: "not-a-uuid" });
  expect(lines[0]).not.toHaveProperty("plant.request_id");
});

it("answers 204 to a body it cannot read, saying so once", async () => {
  const lines = captureServerLog();
  const response = await post("{not json", { type: "application/json" });
  expect(response.status).toBe(204);
  expect(lines).toEqual([
    expect.objectContaining({
      event: "browser.report",
      "plant.outcome": "bad_request",
    }),
  ]);
});

it("reads no more than its limit of a long body", async () => {
  const lines = captureServerLog();
  const response = await post(
    JSON.stringify({ kind: "error", type: "x", pad: "y".repeat(200_000) }),
  );
  expect(response.status).toBe(204);
  expect(lines[0]).toMatchObject({ "plant.outcome": "bad_request" });
});

it("drops a sender past its limit, logging the first drop only", async () => {
  const lines = captureServerLog();
  const { POST } = await import("./route");
  const send = () =>
    POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "2.2.2.2" },
        body: JSON.stringify({ kind: "error" }),
      }),
    );
  for (let i = 0; i < 25; i += 1) await send();
  expect(lines.filter((line) => line.event === "browser.error")).toHaveLength(
    20,
  );
  expect(
    lines.filter((line) => line["plant.outcome"] === "dropped"),
  ).toHaveLength(1);
});
