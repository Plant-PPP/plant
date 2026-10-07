# Threat model: <what changes>

Branch `<type>/pla-<n>-<slug>` (PLA-<n>). Which PR template trigger requires it and why.

## Scope and assets

What data and capabilities this change protects (holdings, amounts, uploaded documents, session, CUIT/DNI/CBU) and what is left out.

## Trust boundary

Where text or data we don't control comes in (uploaded file, user input, model response, webhook) and who is on each side.

## Data flow

Step by step, from the browser to the database and the external providers. Name each component (`apps/web`, `/api/inngest`, Storage, Gemini, Anthropic).

## Where it is enforced

Each control and the layer it lives in: RLS and grants, `proxy.ts`, route handler, job step, prompt.

## STRIDE

| | Vector | Control |
|---|---|---|
| **S** | Spoofing | |
| **T** | Tampering | |
| **R** | Repudiation | |
| **I** | Information disclosure | |
| **D** | Denial of service | |
| **E** | Elevation of privilege | |

## Controls as built

- **<control>**: what it does and which test proves it.

## Residual risk

What stays open, why it is accepted and when it is reviewed.
