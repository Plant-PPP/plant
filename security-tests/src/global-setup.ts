import { type LocalStack, readLocalStack } from "./local-stack";
import { createUser, deleteUsers } from "./pentest-users";

// Kong answers 502/503 while PostgREST is still loading its schema cache.
async function waitForRest(stack: LocalStack): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${stack.apiUrl}/rest/v1/`, {
        headers: { apikey: stack.anonKey },
      });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("PostgREST not ready after 10 s");
}

// Two users for every spec, created once per run: Auth allows 30 sign-ins
// per 5 minutes (supabase/config.toml).
export default async function globalSetup(): Promise<void> {
  const stack = readLocalStack();
  await waitForRest(stack);

  const ids: string[] = [];
  const track = (id: string) => {
    ids.push(id);
    process.env.PENTEST_USER_IDS = JSON.stringify(ids);
  };
  try {
    const a = await createUser(stack, track);
    const b = await createUser(stack, track);
    process.env.PENTEST_STACK = JSON.stringify({
      apiUrl: stack.apiUrl,
      anonKey: stack.anonKey,
    });
    process.env.PENTEST_USERS = JSON.stringify({ a, b });
  } catch (error) {
    // Jest skips globalTeardown when globalSetup throws.
    await deleteUsers(stack, ids).catch(() => undefined);
    throw error;
  }
}
