---
name: clocknext-onboarding
description: Guide a product end-to-end onto ClockNext usage-based billing using the ClockNext MCP tools — detect and enable the models it uses, create entitlements (credits / outcomes / units) and a plan, then meter every billable call in the codebase and prove it with a dummy customer and live signals. Fully human-in-the-loop, sandbox-first, and UI-first for catalogue setup. Use whenever the user is doing anything with ClockNext — setting up billing, creating or pricing credits/outcomes/units/plans, adding models, metering or charging for LLM/API calls, wiring agentKey or customerId into their app, or onboarding customers. If the request has nothing to do with ClockNext, ignore this skill.
---

# Onboard a product onto ClockNext usage-based billing

Take a product from "nothing metered" to "billed, tested, and live" with ClockNext, one
confirmed step at a time. Everything the MCP writes is **real org state**, so this is a
slow, human-in-the-loop process — you propose, the user decides.

## When this runs
Any ClockNext work: setting up billing, adding models, creating/pricing entitlements or
plans, metering calls, wiring the SDK/API into a codebase, or onboarding customers. If a
request isn't about ClockNext, **ignore this skill entirely**.

## Non-negotiable rules (apply to every step)
1. **Human-in-the-loop. Never guess a write.** Confirm every model / entitlement / plan /
   customer / purchase before creating it. **You may NEVER invent or auto-assign an
   `agentKey`** — it is always chosen by the user from real, already-created entitlements.
2. **Sandbox first.** `clocknext_whoami` tells you sandbox vs live. Do the whole build +
   test on sandbox; only promote to live once the user has seen it work.
3. **Meter every billable call.** Surf the *entire* codebase for LLM/API calls — miss none.
4. **Docs are the source of truth.** Before you explain a ClockNext concept or write
   integration code, `clocknext_search_docs` → `clocknext_get_doc`. Never rely on memory.
5. **JS/TS codebase → `@clocknext/sdk`. Any other language → the REST API.** Decide once,
   up front, by inspecting the codebase.
6. **The `cnk_` API key is a server-side secret** — env / secret store only, never
   client-side, never committed.
7. **Catalogue is UI-first.** For creating and pricing credits / outcomes / units / plans,
   *lead with the dashboard link* (it's clearer and shows a live price preview), then offer
   "…or I can do it via MCP if you prefer." Links: `references/ui-links.md`.
8. **Re-derive state on re-entry.** This flow spans many turns with hard STOP gates. When
   resuming, read current state from the tools (`list_models`, `list_credits`, …) — don't
   assume where you left off.

## The flow

### 0 — Orient
- `clocknext_whoami` → which organisation, and **sandbox or live?** Say it out loud.
- `clocknext_list_models` → what's already enabled.
- **Surf the codebase** for the model(s) and provider(s) it actually calls.

### 1 — Models
For each model the code uses → `clocknext_add_model` (provider + catalog id). Report which
models were enabled.
- If the tool returns a **`warning` that the model has no catalog price**: tell the user
  *"the provider you're using doesn't publish pricing for {model} — [click here]({base}/settings/models)
  to set its price"* and **STOP.** Resume only when they confirm it's priced.
- If a model/provider **isn't in the catalog at all**, it can't be metered — surface that and
  help them pick a supported model.

Details: `references/pricing-and-models.md`.

### 2 — Entitlements (repeat until the user is happy)
Explain the **three** entitlement types and their use-cases, then ask which they want (they
can have several, and more than one of each):
- **Credit** — a token-metered balance drawn down per call. General "credits" pricing.
- **Outcome** — billed per *completed* multi-step deliverable (e.g. "1 contract reviewed").
- **Unit** — a fixed price per *event*, no tokens (seats, reports, actions). Priced **FLAT**
  (one price per event — FLAT lives here, under units) or tiered (SLAB / VOLUME).

For each one they choose:
- **Give the create link first** (`{base}/credits`, `{base}/outcomes`, `{base}/units`), then
  *"…or via MCP if you want."*
- If they go via MCP, gather details **in a loop** — for pricing, ask **which enabled
  model(s) set the base price and the token split**. If it gets fiddly, send them to the UI.
  The server grounds the base price in enabled models and **rejects turned-off ones**, so a
  half-built or stale bundle is refused with a clear message.
- After each, confirm and ask "another entitlement?" **Loop until they're satisfied.**

> **Wallet** isn't one of the three — it's a plan component: a prepaid USD balance debited at
> raw model cost. Tell the user plainly: **wallet carries no margin — you make no profit on
> wallet spend.** Full breakdown (incl. unit FLAT vs plan FLAT): `references/entitlements.md`.

### 3 — Plan
A plan bundles entitlements (+ optional WALLET / FLAT components) and sets what a customer
pays. **Give `{base}/plans` first**, then offer MCP. Ask for **every** detail: billing cycle,
currency, each component's billing mode (ADVANCE up-front vs ARREAR metered) and quantity.
Confirm before creating.

### 4 — Customer + code (two pathways — ask which)
**Path 1 — Quick test with a dummy customer** (prove it end to end):
1. `clocknext_create_customer` (a throwaway) → `clocknext_create_purchase` onto the plan.
2. **Surf the codebase; meter every billable call.** For **each** call, list the real
   `agentKey`s (from `clocknext_list_credits` / `_outcomes` / `_units`) and **ask the user
   which one this call maps to** — never infer. Outcomes use the *step's* agentKey.
3. Put the `cnk_` key in the server env.
4. **Run-down test:** `clocknext_verify_signal` (dry run) → a real call → then
   `clocknext_get_customer_usage` / `_balances` / `_unit_usage` to confirm signals landed and
   credits/outcomes/units moved.
5. Then ask: **"Want to wire real customer onboarding now?"**

**Path 2 — Real onboarding:**
1. Add a `clocknextCustomerId` column to the tenant/user table; create a ClockNext customer
   on signup; backfill existing users.
2. Do the same metering + testing as Path 1, against real customers.

How-to: `references/code-metering.md` and `references/testing.md`.

## Units are NOT LLM calls
"Meter every LLM call" is about **credit / outcome / wallet** signals (token-priced). A
**unit is a per-event meter** — one call = one unit, no tokens. Meter units **in the
customer's product** via `signals.unit()` (SDK) or `POST /api/v1/units` (REST) — **never
through the MCP.** The MCP is for *building* the catalogue, not for the product's runtime
metering.
