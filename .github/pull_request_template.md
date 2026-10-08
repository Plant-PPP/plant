<!--
Title: Conventional Commits, under 70 characters, ending in the Linear key when there is an issue (for example `feat(web): add manual holdings entry (PLA-26)`).
Destructive migration: the title starts with `[DESTRUCTIVE]`, before any stacked-PR `(N/X)` marker.
Delete the sections that don't apply.
-->

## Intent

_What changes, why, and what the user sees. Describe the final state, not how you got there._

Linear: PLA-

## Security

> [!IMPORTANT]
> A change is **sensitive** if it touches: auth, sessions or MFA, RLS or grants, exporting or deleting data, uploading or reading files, a new provider, a new field with financial or personal data (CUIT, DNI, CBU, amounts, holdings), or AI prompts that include user data.

- [ ] Not sensitive
- [ ] Sensitive: fill in below

**What data it touches and who can see it after the change:**

**STRIDE, what could go wrong:**

### Does it need a threat model?

> [!WARNING]
> If you check any, a threat model goes in `docs/threat-models/` (start from `_template.md`).

- [ ] None applies
- [ ] New endpoint or trust boundary change
- [ ] New field with financial or personal data
- [ ] New dependency or provider that processes user data (includes a new AI provider or use case)
- [ ] Change in authentication, session, MFA or RLS
- [ ] New user-controlled upload, import or export

**Threat model:**

## Verification

**How I tested it (commands, staging URL, screenshots):**

- [ ] Per-user isolation tests (pgTAP) and a pentest spec (`security-tests/`) for every new table with user data (or `n/a`)
- [ ] No `.env`, keys, real documents or personal data in the diff

## Migration

> [!CAUTION]
> Destructive migrations (dropping a column or table, narrowing a type) carry `[DESTRUCTIVE]` in the title **and** a rollback plan.

- [ ] Not destructive
- [ ] Destructive: title with `[DESTRUCTIVE]`

**Rollback plan:**

## AI

- [ ] An AI assistant wrote code in sensitive paths (auth, RLS, migrations, dependencies, CI): what it generated
- [ ] Adds or changes calls to an AI provider: cost recorded with `ai-cost.ts` and outside text through `prompt-text.ts` (both arrive with the first AI call)
