# Threat model: endpoint `/api/inngest`

Branch `claude/project-thread-7gbyoe` (PLA-7). Required by the trigger "New endpoint or trust boundary change": `/api/inngest` is exposed to the internet on every Vercel deploy.

## Scope and assets

Deployed, the endpoint serves a single function, `ping`, which reads and writes no data. Under `next dev` it also serves `refresh-quotes` (PLA-93), the first function that holds the service role: it writes the day's quotes, which every user reads, and it registers only in dev-server mode, where signatures are off. What the endpoint protects is the ability to run Plant functions and to register the app with Inngest. When imports arrive (the "Carga con IA" stage), those functions will use the service role, so this endpoint becomes the door to every user's documents and holdings.

## Trust boundary

Anyone on the internet can send GET, POST or PUT to `/api/inngest` (HEAD goes to GET; Next answers OPTIONS without touching Inngest). Only Inngest, which signs every request with `INNGEST_SIGNING_KEY`, may run functions, read the introspection or sync the app.

## Data flow

1. An event reaches Inngest (for now only `plant/ping`).
2. Inngest sends a signed POST to `/api/inngest` on Vercel (`apps/web/src/app/api/inngest/route.ts`).
3. The SDK verifies the signature and runs the function from `packages/jobs`.
4. To sync, the dashboard or the Vercel integration sends a signed PUT (in-band).

## Where it is enforced

- `packages/jobs/src/client.ts`: dev mode (no signature verification) comes from `NODE_ENV === "development"`, which Next sets at build time. `INNGEST_DEV` cannot turn it on.
- `packages/jobs/src/index.ts`: `createServeOptions` with `enableUnauthedSync: false`; it registers `refresh-quotes` only in dev-server mode (`DEV_SERVER_MODE`, from `NODE_ENV`) and only then builds its dependencies.
- Local dev: `next dev` and the Inngest dev server's API and UI (8288) bind 127.0.0.1 (`apps/web/package.json`, `scripts/setup/dev-up.sh`, pinned by `scripts/dev-bind.test.mjs`), so other devices cannot reach them. The dev server's connect gateway (8289) and gRPC ports (50052, 50053) cannot be bound in `inngest-cli` 1.46.0 and stay open to the network; Plant runs no `connect()` worker, and the macOS firewall blocks them. The job writes wherever `next dev`'s Supabase env points: `pnpm dev:up` rewrites it to local Supabase, and Vercel's Development environment never holds the service-role key.
- The SDK: verifies the HMAC signature with a 5-minute window and answers 500 if the signing key is missing.

## STRIDE

|       | Vector                                                                       | Control                                                                                                    |
| ----- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **S** | A third party sends a POST pretending to be Inngest                          | Mandatory HMAC signature outside `next dev`                                                                |
| **T** | An unsigned PUT re-registers the app with a URL taken from the `Host` header | `enableUnauthedSync: false`                                                                                |
| **R** | No record of who triggered a function                                        | Inngest stores every run; `audit_log` arrives with the functions that touch data                           |
| **I** | An unsigned GET reads the introspection                                      | 401 without a valid signature                                                                              |
| **D** | Mass unsigned requests                                                       | Rejected before running; the body is parsed before the signature is verified, within Vercel's 4.5 MB limit |
| **E** | An `INNGEST_DEV` variable in Vercel turns signatures off                     | `isDev` set from `NODE_ENV`, not from the variable                                                         |

## Controls as built

- **The endpoint uses those options**: `apps/web/src/app/api/inngest/route.test.ts` checks that the deployed route rejects an unsigned sync, serves two functions under `next dev` and one, `ping`, to a signed introspection in production. `packages/jobs/src/functions/refresh-quotes.test.ts` checks that no quotes dependency is built outside dev-server mode.
- **Mandatory signature**: `packages/jobs/src/serve.test.ts` checks that unsigned GET and POST return 401 with `INNGEST_DEV=1`, and that a signed GET returns 200.
- **No signing key fails closed**: the same test expects 500.
- **Unsigned sync off**: the same test checks that an unsigned PUT does not call Inngest and that a signed in-band sync (the dashboard's) still works.
- **Mode from `NODE_ENV`**: `packages/jobs/src/client.test.ts`.

## Residual risk

- Vercel previews must use a signing key different from production's (an Inngest branch environment). Tomas sets it up when connecting Inngest to Vercel.
- `INNGEST_DEV`, `INNGEST_BASE_URL` or `INNGEST_API_BASE_URL` holding a URL no longer turn signatures off, but they do redirect outbound traffic (registration and events, with their keys). None of the three may exist in Vercel.
- No log line of its own until its first real job: the proxy skips `/api/inngest`, and a rejected request does not throw, so a spike of them alerts nobody.
- **Under `next dev`, a page open in the developer's browser can reach both servers on 127.0.0.1.** It can post to `127.0.0.1:3000` (a `text/plain` body needs no preflight) and to `127.0.0.1:8288`, where it can send `plant/quotes.refresh` under the dummy event key (runs bounded by `singleton`) or change the dev server's app list. A direct POST to the app runs the job in parallel (singleton and retries live in the Inngest server), fetching the providers from the developer's IP, can forge memoized step output, or sends an unsigned PUT that syncs the app again; in dev mode the app registers at `http://127.0.0.1:3000` (`serveOrigin` in `createServeOptions`) whatever `Host` the request carries, so the sync cannot move the job to another host. Steps return counts and keys only, so the database can only get today's real quotes. Before a deployment registers the function (PLA-73), the replay row below is revisited.
- The signature covers the body, not the URL parameters (`fnId`, `stepId`). It doesn't matter today because `ping` touches no data, but once there are several service-role functions, a captured signed body could be replayed to another function within the 5 minutes. Revisit it when the "Carga con IA" functions are built.
