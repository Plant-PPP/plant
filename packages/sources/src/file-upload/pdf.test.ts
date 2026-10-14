import { pdfPageCount } from "./pdf";

const pdf = (body: string) =>
  new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF`);

it("reads the root /Pages node's count", () => {
  expect(
    pdfPageCount(
      pdf(
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
          "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 42 >> endobj\n" +
          "5 0 obj << /Type /Pages /Parent 2 0 R /Count 2 >> endobj",
      ),
    ),
  ).toBe(42);
});

it("reads a count written before the type", () => {
  expect(
    pdfPageCount(pdf("2 0 obj <</Count 7/Type/Pages/Kids[]>> endobj")),
  ).toBe(7);
});

it("counts the /Page objects when no /Pages count shows", () => {
  expect(
    pdfPageCount(
      pdf(
        "3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n" +
          "4 0 obj << /Type/Page /Parent 2 0 R >> endobj",
      ),
    ),
  ).toBe(2);
});

it("does not know the count of a PDF whose objects are compressed", () => {
  expect(
    pdfPageCount(pdf("1 0 obj << /Type /ObjStm /N 12 >> stream x endstream")),
  ).toBeNull();
});
