import { pathOf, sanitizeNextPath } from "./safe-redirect";

describe("sanitizeNextPath", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "/%2F%2Fevil.example?x=1",
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

  it("keeps encoded slashes in the query and hash", () => {
    expect(sanitizeNextPath("/assets?path=a%2Fb#c%2Fd")).toBe(
      "/assets?path=a%2Fb#c%2Fd",
    );
  });

  it("returns the normalized path", () => {
    expect(sanitizeNextPath("/a/../assets")).toBe("/assets");
  });

  it.each([
    ["/a?b#c", "/a"],
    ["/a#b?c", "/a"],
    ["/a", "/a"],
  ])("takes the path of %s", (raw, path) => {
    expect(pathOf(raw)).toBe(path);
  });
});
