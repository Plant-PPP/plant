import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

describe("Resumen page in production", () => {
  const previous = process.env.VERCEL_ENV;
  beforeAll(() => {
    process.env.VERCEL_ENV = "production";
  });
  afterAll(() => {
    process.env.VERCEL_ENV = previous;
  });

  it("shows an empty state like the other sections", async () => {
    const html = renderToStaticMarkup(await Home());
    expect(html).toMatch(/<p[^>]*>[^<]+<\/p>/);
  });
});
