# Condensed telemetry lens (paste verbatim per subagent)

This is the block review/planning/build skills paste into EVERY subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). There is no separate fat telemetry skill
in Plant — this file IS the lens; the orchestrator reads it once and pastes the block below.

```
=== TELEMETRY LENS (attack every signal the change emits: spans, attributes, logs, events, config) ===
On its own `telemetry-lens loaded:`-prefixed line in the load-proof header block (header order:
catalog, ports-lens, dry-lens, perf-lens, comment-lens, telemetry-lens; the tripwire keys on the
PREFIX, not on line position), or this wave is NON-CLEAN and re-run:
  telemetry-lens loaded: every emission routed/named/bounded/clean | telemetry surface: <span/log/attr/event/env list | "none — no signal emitted or configured in diff">
("none" is a CLEAN pass ONLY when stated AND the diff adds no new failure surface — a behavioral
diff that adds a route handler/server action/retry/fallback/flag-branch/outbound call/Inngest
function or step and emits NOTHING is a law-9 DEFECT, not "none". A missing/garbled telemetry-lens
line = NON-CLEAN. A wrongful "none" on a diff that DOES add a log call, a span/attribute, a PostHog
event, an `audit_log` write, or an OTEL_*/POSTHOG_* var is a first-class DEFECT.)

THE ONE LAW: every signal flows through the HOUSE pipeline, carries the canonical service identity,
speaks semconv / `plant.*` vocabulary — cardinality-bounded where it must be (span names, metric
attrs, attribute KEYS, resource attrs), cardinality-RICH where it should be (span/log attribute
VALUES) — is trace-correlated — user- and import-scoped work stamps its correlation ids on the wide
event — and never carries a secret, PII, or financial data. A signal that doesn't DETECT, LOCALIZE,
or EXPLAIN is not emitted. Telemetry shape is observable output — it changes only deliberately,
with its pin.

HOUSE PIPELINE (the only sanctioned emitters — three distinct channels, never mixed):
- TRACES/LOGS: OpenTelemetry from `apps/web` (Next.js instrumentation hook; the Inngest endpoint
  `/api/inngest` and the chat route run inside it, so jobs and the assistant are traced through the
  same setup) → Dash0 (export goes live in December; until then the instrumentation is still written
  the house way, it simply has no backend). One shared setup module, never a per-route or
  per-package SDK/exporter. Pure steps in `@plant/sources` / `@plant/core` stay engine- and
  vendor-free: they return outcomes; the orchestrator in `@plant/jobs` / the route records them.
- PRODUCT ANALYTICS: PostHog (EU region), PRODUCTION ONLY (disabled in dev/preview), MANUAL events
  only — no autocapture, no session replay — through one house wrapper that scrubs CUIT/DNI/CBU
  before send. PostHog is not a log sink and not an audit trail.
- AUDIT: the append-only `audit_log` table (insert-only; no UPDATE/DELETE path for anyone). Audit
  is NOT telemetry (law 10).
METRICS do not exist yet — a first metric is a platform change in the shared setup module
(instrument + UCUM unit + bounded attrs), not a drive-by createCounter.

THE TEN CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. HOUSE-PIPELINE — no parallel SDK/exporter/provider, no blanket auto-instrumentation package
   added without the platform decision, no SDK-side sampler sprinkled per call site, no
   OTEL_RESOURCE_ATTRIBUTES hand-set per service. No baggage for identity. Tracers acquired LAZILY
   in functions (module-scope getTracer before init = no-op tracer); house helpers BUNDLE the OTel
   API, never rename/hide it. PostHog only via the house wrapper; never `posthog-js` initialised
   ad hoc in a component.
2. RESOURCE-IDENTITY — service.name (`plant-web`), service.version (commit sha),
   deployment.environment.name (production/preview/development) and cloud.region travel together
   on the RESOURCE, set once in the shared setup, never duplicated onto spans.
3. SPAN-HYGIENE — low-cardinality `{verb} {object}` names (IDs/paths/queries are attributes, never
   names); kind by communication pattern (outbound sync incl. DB/AI/price calls = CLIENT, async =
   PRODUCER/CONSUMER, INTERNAL only for local); status UNSET by default, ERROR only on FINAL failure
   WITH a message + error.type, 4xx-on-SERVER is NOT ERROR, handled/retried-success is NOT ERROR
   (test: "could the operation do its job?" — a rejected upload is the operation WORKING); headless
   work (each Inngest function run) gets a root span; no span-per-iteration — one batch span.
   Every cross-process hop CARRIES correlation: an Inngest event carries the import id (and the
   trace context where the SDK supports it); consumers link by span links + correlation id, never
   as children of a long-lived parent; manual spans END on every path (startActiveSpan /
   try-finally); every failure site gets a static greppable slug (never dynamically built) + an
   expected-marker for expected-unactionable failures (e.g. an unreadable PDF).
4. WIDE-EVENT-CORRELATION — one wide event per unit of work (the request root span, or the
   Inngest run root span, enriched at the house chokepoints — in Next getActiveSpan() is often a
   render CHILD, use the root span). User-scoped work MUST stamp `enduser.id` (the opaque Supabase
   user uuid) and, for import work, `plant.import.id`, plus `plant.outcome` and
   http.response.status_code/error.type. Test: "could Dash0 answer success-rate-per-import-source
   for this path?" — no = DEFECT. Identity comes from server-resolved session state ONLY, never a
   client-supplied header or body field. Required when the diff creates them: a flag-gated path
   stamps feature_flag.* key+variant; a versioned-logic outcome (prompt/model/extraction ruleset)
   stamps its version. Outcome/status stamped ONLY on the wide event — copied onto child spans =
   double-counted aggregates.
5. SEMCONV-VOCAB & CARDINALITY — registry key first (error.type, enduser.id, http.route, db.*,
   url.template, gen_ai.*); custom = `plant.*`; bare names invalid; unbounded values NEVER in a span
   name, metric attribute, or RESOURCE attribute — but high-cardinality ids on span/log attributes
   are REQUIRED, not tolerated (stripping an id "for cardinality" is a defect; law 7 decides what
   may not ride). Attribute KEYS are bounded: never build a key from data (`plant.holding.<id>`) —
   the id goes in the VALUE. Model-call spans (Gemini extraction, Claude Haiku assistant) speak
   gen_ai.* semconv (model, token counts, finish reason); cost is derived at query time from
   `ai-cost.ts` rates — a cost attribute is a defect. PostHog event names: one closed, documented
   set (`object_action`), never built from data.
6. STRUCTURED-CORRELATED-LOGS — single-line structured JSON via the house logger; never string
   interpolation, never multi-line (stack trace serializes into exception.stacktrace with
   exception.type/message); pass the RAW error to logger.error, never pre-stringified; a log inside
   a span carries trace correlation. Severity matches the outcome like span status: error only for
   genuine final failures, failures never at info, no debug noise on hot paths. `console.*` in
   server code is a defect once the house logger exists.
7. NO-SENSITIVE-DATA — never in ANY field of ANY channel (span, log, PostHog event, error message,
   audit row): credentials/tokens/cookies/auth headers/request bodies; emails, names, CUIT/DNI/CBU;
   amounts, balances, holdings, tickers-with-quantities, net worth, debts; uploaded document text or
   extracted JSON; prompts/completions. No object spreads ({...body}, {...holding}) into
   signals; opaque user uuid only; no user input echoed into status messages; large payloads ride
   as a system-of-record id (import id, storage path), never inline. Log ids and COUNTS (holdings
   extracted: 12), never VALUES. Judge re-identification over the attribute SET, not per field.
   PostHog scrubbing is a NET — reaching it with sensitive data is already the defect.
8. SIGNAL-DENSITY & SHAPE — every new signal names its purpose (detect/localize/explain) and a new
   span passes the house test: INTERESTING and AGGREGATABLE (one wide span beats many thin ones);
   sub-phase durations + dependency call rollups (AI calls, price lookups, DB query count) ride the
   wide event; granularity is two-sided — a long span with no children over remote/DB/model calls
   is unaccounted time (add children at call boundaries), a sub-millisecond in-process span is
   overhead; never emit a field derivable from the same event — compute at query time; a shape
   change (rename/remove/add of an emitted name/key/field/PostHog event) states before/after in the
   PR body and moves its pinning test in the same change — a pin edited to absorb drift is a
   DEFECT.
9. INSTRUMENTATION-COMPLETENESS — under-emission is a DEFECT. The review question for every
   behavioral diff: "how will I know if this change is working as intended?" A new failure surface
   (route handler/server action/retry/fallback/flag branch/outbound AI or price call/Inngest
   function or step) ships its instrumentation IN THE SAME DIFF. Domain outcomes count, not just
   transport (auto-instrumentation sees the 500, not "extraction consensus failed"/"import
   cancelled"/"document unreadable" — those land as outcome/reason on the wide event). Never
   deferrable: it is by definition in the diff's blast radius.
10. AUDIT-DISTINCT — audit is NOT ordinary telemetry. Audit facts (sign-in-relevant actions, import
   confirmed/cancelled, data deleted/exported, assistant tool invoked) go to the `audit_log` table:
   insert-only, written AFTER the operation with its real outcome, carrying `user_id`, a
   dot-namespaced EXTEND-ONLY action vocabulary (never rename a value), outcome =
   success|failure|denied (never boolean), and entity ids — never amounts, document content, or
   PII. The table is the system of record; spans/logs/PostHog are never relied on for audit, and an
   `audit_log` UPDATE/DELETE path (policy, grant, or code) is a DEFECT.

SEVERITY: secret/PII/financial value in any field / parallel SDK or exporter / unbounded
span-name-or-metric-attr / bare custom attr / object spread into a signal / PostHog firing outside
production or bypassing the scrubbing wrapper / autocapture or session replay enabled / user-scoped
work with NO correlation ids on its wide event / identity trusted from a client-suppliable field /
audit action value renamed-or-repurposed / mutable `audit_log` / inline document-prompt-completion
payload in a field = HARD blockers (any one = does not merge). console.* where the house logger
exists / new log path uncorrelated / headless Inngest run unrooted / missing pin on a NEW emission
= raise-and-downgradable (defer only if pre-existing AND outside the blast radius; state it, don't
default).

ONLY sanctioned exceptions: (a) script/CLI stdout in `scripts/` = developer output; (b) a noisy
diagnostic behind a kill switch, one line naming purpose + off-switch + death condition (missing
any = defect). KNOWN GAPS ARE DEBT, NOT EXCEPTIONS (no Dash0 export before December, no metrics):
none blocks an unrelated change, every touch RAISES the gap (name it + file the follow-up), and a
change CLOSING one through the house pipeline is the goal state.

PER-LAW VERDICT: if the change emits, alters, or configures ANY signal — or ADDS a failure surface
(law 9 applies even when nothing is emitted) — emit PASS|DEFECT + one line for each of the ten
laws. If it touches NO telemetry surface AND adds no failure surface, emit exactly:
  telemetry: N/A — no signal emitted or configured, no new failure surface (no span, log call, attribute, PostHog event, audit_log write, OTEL env, or new route/action/retry/flag/dep/Inngest step in diff).
=== END TELEMETRY LENS ===
```
