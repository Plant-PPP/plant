import { redirect } from "next/navigation";
import { settle } from "./server-action-call";

test("passes an answer through", async () => {
  await expect(settle(Promise.resolve({ ok: true }))).resolves.toEqual({
    ok: true,
  });
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
