# Metering the codebase

## SDK vs API (decide first, by inspecting the codebase)
- **JS / TS codebase → `@clocknext/sdk`** — typed, with batching, retries, and idempotency
  built in.
- **Any other language → the REST API** — `POST /api/v1/usage` for credit / outcome / wallet
  signals, `POST /api/v1/units` for unit events.
Ground the exact call shapes in the docs first (`clocknext_search_docs kind=javascript` for
JS/TS, `kind=api` otherwise).

## The agentKey rule (human-in-the-loop — do NOT get this wrong)
Every credit/outcome signal carries an `agentKey` that must **exactly match** a created
entitlement. The mapping is the user's decision, never yours:
1. Pull the real keys: `clocknext_list_credits`, `clocknext_list_outcomes` (each **step** has
   its own key), `clocknext_list_units`.
2. For **every** call site you're about to meter, show the candidate keys and **ask the user
   which one this call maps to.**
3. **Never invent, guess, or reuse a key without an explicit pick.** A wrong key silently
   meters against the wrong entitlement and corrupts billing.

## Units are not LLM calls
Meter units where the *event* happens in the customer's product — `signals.unit({ agentKey })`
(SDK) or `POST /api/v1/units` (REST). One call = one unit: no tokens, no model. This is the
product's runtime job, **not** the MCP's — the MCP only builds the catalogue.

## Reliability & safety
- Reuse a stable **`idempotencyKey`** per logical event so retries never double-bill (the SDK
  auto-generates one; pass your own wherever the code has a natural request id).
- Keep the `cnk_` key **server-side** (env / secret store) — never ship it to the client,
  never commit it.
- Meter on the **billable boundary** (the real model/API call), not on UI events.
- Send signals from the **server**, after the work succeeds.
