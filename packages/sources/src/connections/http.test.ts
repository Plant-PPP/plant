import { call } from "./http";

it("fails as unavailable without the network error, which may name the request", async () => {
  const get = jest
    .fn()
    .mockRejectedValue(
      new TypeError("fetch failed: https://x.test/?token=SECRET_TOKEN"),
    );
  const failed = await call(get, "https://x.test/", {}, 1000).catch(
    (error: unknown) => error,
  );
  expect(failed).toMatchObject({ code: "extraction_failed", retryable: true });
  expect((failed as Error).cause).toBeUndefined();
});
