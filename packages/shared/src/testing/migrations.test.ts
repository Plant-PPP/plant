import { migrations } from "./migrations";

describe("migrations", () => {
  it("reads every migration in the order they apply", () => {
    const files = migrations().map(({ file }) => file);
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual([...files].sort());
  });
});
