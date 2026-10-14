import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A provider faked on a local HTTP server, for adapter tests: it records
// every request and answers with `answer`.
export type FakeRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
};
export type FakeReply = {
  status: number;
  body: unknown;
  // XML and text bodies are sent as given; anything else as JSON.
  type?: "json" | "xml" | "text";
};

export type FakeProvider = {
  url: string;
  requests: FakeRequest[];
  answer: (request: FakeRequest) => FakeReply;
  close: () => Promise<void>;
};

export async function startFakeProvider(): Promise<FakeProvider> {
  const fake: FakeProvider = {
    url: "",
    requests: [],
    answer: () => ({ status: 404, body: {} }),
    close: async () => undefined,
  };
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      const url = request.url ?? "";
      const [path = "", raw = ""] = url.split("?");
      const recorded: FakeRequest = {
        method: request.method ?? "",
        path,
        query: new URLSearchParams(raw),
        url,
        headers: request.headers,
        body,
      };
      fake.requests.push(recorded);
      const reply = fake.answer(recorded);
      const type = reply.type ?? "json";
      response.writeHead(reply.status, {
        "content-type":
          type === "xml"
            ? "application/xml"
            : type === "text"
              ? "text/plain"
              : "application/json",
      });
      response.end(
        type === "json" ? JSON.stringify(reply.body) : String(reply.body),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}
