import { randomBytes, randomUUID } from "node:crypto";

import { type Insert, rest, users } from "./pentest-helpers";
import { createRow, principalOf } from "./portfolio-setup-rows";
import type { TestUser } from "./pentest-users";

// A file row of `user`'s, in `accountId`, at a path under their folder.
export const documentOf = (
  user: TestUser,
  accountId: string,
): Insert<"uploaded_documents"> => ({
  source_connection_id: accountId,
  storage_path: `${user.id}/imports/${randomUUID()}/${randomUUID()}`,
  file_name: "resumen.pdf",
  mime_type: "application/pdf",
  size_bytes: 1024,
  sha256: randomBytes(32).toString("hex"),
});

// Writes `body` to `table` as `user` and returns the new row's id.
export async function inserted<T extends "uploaded_documents" | "imports">(
  user: TestUser,
  table: T,
  body: Insert<T>,
): Promise<string> {
  const res = await rest(user, "POST", `${table}?select=id`, {
    body,
    headers: { Prefer: "return=representation" },
  });
  expect(res.status).toBe(201);
  return (res.body as { id: string }[])[0]!.id;
}

export type Uploads = {
  account: { a: string; b: string };
  document: { a: string; b: string };
};

// Each user gets an account, a file in it and its import.
export async function setUpUploads(): Promise<Uploads> {
  const { a, b } = users;
  const account = {
    a: await createRow(a, "source_connections", {
      institution: "IOL",
      default_portfolio_id: await principalOf(a),
    }),
    b: await createRow(b, "source_connections", {
      institution: "IOL",
      default_portfolio_id: await principalOf(b),
    }),
  };
  const document = {
    a: await inserted(a, "uploaded_documents", documentOf(a, account.a)),
    b: await inserted(b, "uploaded_documents", documentOf(b, account.b)),
  };
  await inserted(a, "imports", { document_id: document.a });
  await inserted(b, "imports", { document_id: document.b });
  return { account, document };
}
