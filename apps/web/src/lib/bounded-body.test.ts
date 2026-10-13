import { boundedText } from "./bounded-body";

const streamed = (parts: string[], headers: HeadersInit = {}) =>
  new Request("http://localhost/", {
    method: "POST",
    headers,
    body: new ReadableStream({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(new TextEncoder().encode(part));
        }
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);

it("reads a body up to the limit", async () => {
  expect(await boundedText(streamed(["ab", "cd"]), 4)).toBe("abcd");
});

it("refuses a longer body whatever length it claims", async () => {
  const request = streamed(["ab", "cde"], { "content-length": "4" });
  expect(await boundedText(request, 4)).toBeNull();
});

it("reads no body as empty", async () => {
  expect(await boundedText(new Request("http://localhost/"), 4)).toBe("");
});
