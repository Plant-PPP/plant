import { sanitizeNextPath } from "./safe-redirect";

describe("sanitizeNextPath", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/%5C%5Cevil",
    "/%09/evil",
    "/..//evil.example",
    "/./\\evil",
    "\t/",
    "javascript:alert(1)",
    "",
    undefined,
    ["/a"],
  ])("falls back for %p", (raw) => {
    expect(sanitizeNextPath(raw)).toBe("/");
  });

  it("keeps a same-origin path with its query and hash", () => {
    expect(sanitizeNextPath("/assets?x=1#a")).toBe("/assets?x=1#a");
  });

  it("returns the normalized path", () => {
    expect(sanitizeNextPath("/a/../assets")).toBe("/assets");
  });

  it("uses the given fallback", () => {
    expect(sanitizeNextPath("//evil.example", "/x")).toBe("/x");
  });
});
