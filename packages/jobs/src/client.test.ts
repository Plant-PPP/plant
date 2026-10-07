import { loadWithEnv, restoreEnv } from "./testing";

function loadClientMode(env: Record<string, string>): string {
  return loadWithEnv(env, () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { inngest } = require("./client") as typeof import("./client");
    return inngest.mode;
  });
}

afterEach(restoreEnv);

describe("inngest client mode", () => {
  it("stays in cloud mode (signatures checked) outside development, even with INNGEST_DEV=1", () => {
    expect(loadClientMode({ NODE_ENV: "production", INNGEST_DEV: "1" })).toBe(
      "cloud",
    );
  });

  it("uses the local Dev Server in development", () => {
    expect(loadClientMode({ NODE_ENV: "development", INNGEST_DEV: "0" })).toBe(
      "dev",
    );
  });
});
