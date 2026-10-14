import { readCappedBytes } from "./http";

const stream = (chunks: Uint8Array[], cancel?: () => void) =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });

const bytes = (length: number) => new Uint8Array(length).fill(7);

describe("readCappedBytes", () => {
  it("reads a body of exactly the cap", async () => {
    const body = new Response(stream([bytes(3), bytes(2)]));
    expect(await readCappedBytes(body, 5, { over: "fail" })).toEqual(bytes(5));
  });

  it("refuses unread a body that declares more than the cap", async () => {
    const cancel = jest.fn();
    const body = new Response(stream([bytes(1)], cancel), {
      headers: { "content-length": "6" },
    });
    expect(await readCappedBytes(body, 5, { over: "fail" })).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("stops reading a body that streams past the cap", async () => {
    const cancel = jest.fn();
    const body = new Response(stream([bytes(3), bytes(3), bytes(3)], cancel));
    expect(await readCappedBytes(body, 5, { over: "fail" })).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("cuts a body past the cap at the cap, whatever it declares", async () => {
    const body = new Response(stream([bytes(3), bytes(3)]), {
      headers: { "content-length": "6" },
    });
    expect(await readCappedBytes(body, 5, { over: "cut" })).toEqual(bytes(5));
  });

  it("ignores a cancel that fails", async () => {
    const failing = () => {
      throw new Error("cancel failed");
    };
    const declared = new Response(stream([bytes(1)], failing), {
      headers: { "content-length": "6" },
    });
    expect(await readCappedBytes(declared, 5, { over: "fail" })).toBeNull();
    const streamed = new Response(stream([bytes(6)], failing));
    expect(await readCappedBytes(streamed, 5, { over: "fail" })).toBeNull();
  });

  it("reads no body as empty", async () => {
    expect(
      await readCappedBytes(new Response(null), 5, { over: "fail" }),
    ).toEqual(new Uint8Array());
  });
});
