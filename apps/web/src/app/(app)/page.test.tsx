import { renderToStaticMarkup } from "react-dom/server";
import Home from "./page";

const visibleText = (html: string) =>
  html
    .replace(/<h1 class="sr-only">[^<]*<\/h1>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();

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
    expect(visibleText(html)).not.toBe("");
  });
});
