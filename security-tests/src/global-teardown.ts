import { readLocalStack } from "./local-stack";
import { deleteUsers } from "./pentest-users";

export default async function globalTeardown(): Promise<void> {
  const ids: string[] = JSON.parse(process.env.PENTEST_USER_IDS ?? "[]");
  if (ids.length > 0) await deleteUsers(readLocalStack(), ids);
}
