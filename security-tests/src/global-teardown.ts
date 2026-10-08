import { readLocalStack } from "./local-stack";
import { deleteUsers, runEnv } from "./pentest-users";

export default async function globalTeardown(): Promise<void> {
  const ids: string[] = JSON.parse(process.env[runEnv.userIds] ?? "[]");
  if (ids.length > 0) await deleteUsers(readLocalStack(), ids);
}
