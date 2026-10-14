import { reportClientError } from "./client";

const REQUEST_ID = "6a2f41a0-0b1c-4d2e-8f30-415263748596";

const fetchMock = jest.fn(async () => new Response(null, { status: 204 }));

function page(meta: string | null) {
  Object.assign(globalThis, {
    fetch: fetchMock,
    window: { location: { pathname: "/assets" } },
    document: {
      querySelector: () => (meta === null ? null : { content: meta }),
    },
  });
}

beforeEach(() => fetchMock.mockClear());

it("posts the report with the page's path and request id", () => {
  page(REQUEST_ID);
  reportClientError({ kind: "realtime", type: "TIMED_OUT" });
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/reports?request=${REQUEST_ID}`,
    expect.objectContaining({
      method: "POST",
      keepalive: true,
      body: JSON.stringify({
        kind: "realtime",
        type: "TIMED_OUT",
        path: "/assets",
      }),
    }),
  );
});

it("leaves out a request id that is not one", () => {
  page("<script>");
  reportClientError({ kind: "error" });
  expect(fetchMock).toHaveBeenCalledWith("/api/reports", expect.anything());
});

it("never throws, even without a page", () => {
  Object.assign(globalThis, { document: undefined });
  expect(() => reportClientError({ kind: "error" })).not.toThrow();
});
