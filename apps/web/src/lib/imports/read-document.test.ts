jest.mock("server-only", () => ({}), { virtual: true });

import { readDocument } from "./read-document";

const input = (mimeType: string) => ({
  bytes: new Uint8Array(),
  mimeType,
  userId: "u1",
  importId: "i1",
  institution: "IOL",
});

const readers = () => ({
  document: jest.fn().mockResolvedValue("document"),
  sheet: jest.fn().mockResolvedValue("sheet"),
});

it.each([
  ["application/pdf", "document"],
  ["image/heic", "document"],
  ["text/csv", "sheet"],
  ["application/vnd.ms-excel", "sheet"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "sheet",
  ],
])("hands %s to the %s reader", async (mimeType, reader) => {
  const each = readers();
  expect(await readDocument(each)(input(mimeType))).toBe(reader);
});

it("refuses a type Cargar does not upload", async () => {
  const each = readers();
  const error = await readDocument(each)(input("application/zip")).catch(
    (e: unknown) => e,
  );
  expect(error).toMatchObject({ code: "unsupported", retryable: false });
  expect(each.document).not.toHaveBeenCalled();
  expect(each.sheet).not.toHaveBeenCalled();
});
