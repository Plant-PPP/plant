import {
  type LocalStack,
  type PublicStack,
  readLocalStack,
} from "./local-stack";
import {
  type PentestUsers,
  createUser,
  deleteUsers,
  prepareAuthCases,
  prepareMfaCases,
  runEnv,
} from "./pentest-users";

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

// Two users for every spec, created once per run: Auth rate-limits sign-ins
// (auth.rate_limit in supabase/config.toml). The service role key stays here,
// so the auth spec's admin steps run here too.
export default async function globalSetup(): Promise<void> {
  const stack = readLocalStack();
  await waitForRest(stack);

  const ids: string[] = [];
  const track = (id: string) => {
    ids.push(id);
    process.env[runEnv.userIds] = JSON.stringify(ids);
  };
  try {
    const a = await createUser(stack, track);
    const b = await createUser(stack, track);
    const publicStack: PublicStack = {
      apiUrl: stack.apiUrl,
      anonKey: stack.anonKey,
    };
    process.env[runEnv.stack] = JSON.stringify(publicStack);
    const users: PentestUsers = { a, b };
    process.env[runEnv.users] = JSON.stringify(users);
    process.env[runEnv.auth] = JSON.stringify(
      await prepareAuthCases(stack, track),
    );
    process.env[runEnv.mfa] = JSON.stringify(
      await prepareMfaCases(stack, track),
    );
  } catch (error) {
    // Jest skips globalTeardown when globalSetup throws.
    await deleteUsers(stack, ids).catch(() => undefined);
    throw error;
  }
}
