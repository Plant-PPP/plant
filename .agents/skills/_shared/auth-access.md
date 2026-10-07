# Auth & access — never stall on a login

Interactive authentication is a step you TAKE, not a message you send. Run the sign-in so the prompt
reaches the user and they complete it there. Don't report "you need to authenticate first", and don't
ask permission to sign in — just run it.

This covers the CLI credential stores below: you launch those flows yourself, including any browser
tab they open. Surface rather than drive only when the credential is a provider login session you
have no command to create — and say which one. (GitHub access may also come through the GitHub MCP
instead of `gh`; if the MCP is connected and working, no CLI sign-in is needed for what it covers.)

**Scope: the orchestrator.** No subagent can reach the user with a prompt — a read-only one is also
fenced off credential state (`subagent-constraints/hard-constraints.md`), and a writer simply has
nobody to prompt. So before spawning a wave that will need a credential, make sure what it reads is
already on disk: sign in to the CLIs below (they persist credentials, so a later shell inherits
them), and if the wave needs app secrets, produce the env file it will read (`vercel env pull
apps/web/.env.local` against the linked project). A subagent that hits the wall reports it upward;
it does not authenticate.

**Don't expose the value.** A secret may land in a generated env file (that is what `vercel env pull`
is for). It must never be echoed into a transcript, a log you keep, a commit, a PR comment, or a
Linear issue.

Plant has no secret-manager CLI yet; secrets live in Vercel and Supabase project settings. When one is
adopted, add its sign-in wrapper here.

## Probe first, sign in only where the probe fails

All three CLIs persist credentials to disk, so a later shell — and a subagent — inherits them. Probe
each with a command that makes an authenticated API call, and sign in only where it comes back
failing:

```bash
gh auth status >/dev/null 2>&1           || gh auth login
supabase projects list >/dev/null 2>&1   || supabase login
vercel whoami >/dev/null 2>&1            || vercel login
```

Probe with a call that hits the provider, not one that only reads the local store: a revoked or
expired token still sits on disk and looks like a session, so a local-only check would skip a
sign-in that is genuinely needed. Probe first because a needless sign-in can leave the user on a
different account than they started on.

The probe is also what tells you WHICH thing failed. If it passed and the real command still failed,
the problem is not authentication — don't re-prompt for it. If the probe itself still fails after a
sign-in, the user most likely missed the prompt: run the sign-in once more. (The CLI not being
installed is neither — report it, with the install command.)

Local development (`supabase start`, `supabase test db`) needs no sign-in at all; only commands that
reach the hosted project do.

## Running an interactive sign-in

Any of these commands can outlive a default Bash timeout, so raise the tool `timeout` — and do NOT
background it, since a detached process cannot receive the input you are waiting for. Only if the
prompt genuinely cannot reach the user do you surface it, with the exact command to run.

⚠️ **Unattended, do NOT start it at all.** With nobody at the terminal there is no prompt to
complete, and "surface it" has no destination — you would burn a raised timeout on a wait that cannot
end. Check the mode first (`.claude/skills/_shared/night-shift/detect.md`). If it is ON:
record `AWAITING-HUMAN: <the exact sign-in command>`, treat that credential's work as a dead track,
and **keep working every track that does not need it**. Never spend the timeout, and never retry.
