const ORIGINAL_ENV = process.env;

function loadClientMode(env: Record<string, string>): string {
  process.env = { ...ORIGINAL_ENV, ...env };
  let mode = "";
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { inngest } = require("./client") as typeof import("./client");
    mode = inngest.mode;
  });
  return mode;
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

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
