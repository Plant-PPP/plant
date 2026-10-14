import { uploadOne } from "./upload-imports";

const file = new File(["%PDF-1.7"], "Resumen.pdf", { type: "" });

const actions = () => ({
  start: jest.fn().mockResolvedValue({
    ok: true,
    uploadId: "up1",
    path: "u1/imports/up1/o1",
    token: "t1",
    type: "application/pdf",
  }),
  finish: jest.fn().mockResolvedValue({ ok: true, importId: "i1" }),
});

it("puts the file at the signed URL as the type its name says, then finishes", async () => {
  const each = actions();
  const put = jest.fn().mockResolvedValue({ error: null });
  expect(await uploadOne(file, "a1", each, put)).toBeNull();
  expect(each.start).toHaveBeenCalledWith({
    fileName: "Resumen.pdf",
    size: file.size,
    accountId: "a1",
  });
  expect(put).toHaveBeenCalledWith(
    "u1/imports/up1/o1",
    "t1",
    file,
    "application/pdf",
  );
  expect(each.finish).toHaveBeenCalledWith({
    uploadId: "up1",
    path: "u1/imports/up1/o1",
    fileName: "Resumen.pdf",
    accountId: "a1",
  });
});

it("sends nothing when the server refuses to start", async () => {
  const each = actions();
  each.start.mockResolvedValue({ ok: false, code: "terms" });
  const put = jest.fn();
  expect(await uploadOne(file, "a1", each, put)).toBe("terms");
  expect(put).not.toHaveBeenCalled();
});

it("does not finish an upload Storage refused", async () => {
  const each = actions();
  const put = jest.fn().mockResolvedValue({ error: new Error("413") });
  expect(await uploadOne(file, "a1", each, put)).toBe("failed");
  expect(each.finish).not.toHaveBeenCalled();
});

it("answers why the server refused the file it got", async () => {
  const each = actions();
  each.finish.mockResolvedValue({ ok: false, code: "duplicate" });
  const put = jest.fn().mockResolvedValue({ error: null });
  expect(await uploadOne(file, "a1", each, put)).toBe("duplicate");
});

it("reads a start or a finish that failed as a failed upload", async () => {
  const each = actions();
  each.start.mockRejectedValue(new Error("network"));
  const put = jest.fn();
  expect(await uploadOne(file, "a1", each, put)).toBe("failed");
  expect(put).not.toHaveBeenCalled();

  const other = actions();
  other.finish.mockRejectedValue(new Error("network"));
  const putOk = jest.fn().mockResolvedValue({ error: null });
  expect(await uploadOne(file, "a1", other, putOk)).toBe("failed");
});
