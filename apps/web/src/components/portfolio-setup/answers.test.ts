import { redirect } from "next/navigation";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import { rowAnswer, settle, sheetAnswer } from "./answers";

const ID = "22222222-2222-4222-8222-222222222222";

describe("rowAnswer", () => {
  test("a restore whose name is taken asks for another one", () => {
    expect(rowAnswer({ ok: false, code: "duplicate_name" }, "restore")).toEqual(
      { kind: "ask_name" },
    );
  });

  test("archiving the last portfolio shows its alert", () => {
    expect(
      rowAnswer({ ok: false, code: "last_active_portfolio" }, "archive"),
    ).toEqual({
      kind: "alert",
      text: "Necesitás al menos una cartera activa.",
    });
  });

  test("an archive never asks for a name", () => {
    expect(rowAnswer({ ok: false, code: "duplicate_name" }, "archive")).toEqual(
      { kind: "alert", text: WRITE_MESSAGES.duplicate_name },
    );
  });

  test("a rejected call shows the failed copy", () => {
    expect(rowAnswer("rejected", "restore")).toEqual({
      kind: "alert",
      text: WRITE_MESSAGES.failed,
    });
  });

  test("a success is done", () => {
    expect(rowAnswer({ ok: true, id: ID }, "archive")).toEqual({
      kind: "done",
    });
  });
});

describe("sheetAnswer", () => {
  test("closes on success and keeps the copy otherwise", () => {
    expect(sheetAnswer({ ok: true, id: ID })).toEqual({ kind: "done" });
    expect(sheetAnswer({ ok: false, code: "duplicate_name" })).toEqual({
      kind: "alert",
      text: "Ya tenés una cartera con ese nombre.",
    });
    expect(sheetAnswer("rejected")).toEqual({
      kind: "alert",
      text: WRITE_MESSAGES.failed,
    });
  });
});

describe("settle", () => {
  test("passes an answer through", async () => {
    await expect(
      settle(Promise.resolve({ ok: true, id: ID })),
    ).resolves.toEqual({ ok: true, id: ID });
  });

  test("turns a failed call into rejected", async () => {
    await expect(settle(Promise.reject(new Error("offline")))).resolves.toBe(
      "rejected",
    );
  });

  test("rethrows the redirect of an ended session", async () => {
    let thrown: unknown;
    try {
      redirect("/login");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    await expect(settle(Promise.reject(thrown))).rejects.toBe(thrown);
  });
});
