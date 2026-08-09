---
name: clocknext-onboarding
description: Guide a product end-to-end onto ClockNext usage-based billing using the ClockNext MCP tools — detect and enable the models it uses, create entitlements (credits / outcomes / units) and a plan, then meter every billable call in the codebase and prove it with a dummy customer and live signals. Fully human-in-the-loop, UI-first for catalogue setup (MCP is the fallback), with a hard stop before anything that spends real money. Use whenever the user is doing anything with ClockNext — setting up billing, creating or pricing credits/outcomes/units/plans, adding models, metering or charging for LLM/API calls, wiring agentKey or customerId into their app, or onboarding customers. If the request has nothing to do with ClockNext, ignore this skill.
---

# Onboard a product onto ClockNext usage-based billing

Take a product from "nothing metered" to "billed, tested, and live" with ClockNext, one
confirmed step at a time. Everything the MCP writes is **real org state** — and a purchase
raises a **real invoice** — so this is a slow, human-in-the-loop process: you propose, the
user decides.

## When this runs
Any ClockNext work: setting up billing, adding models, creating/pricing entitlements or
plans, metering calls, wiring the SDK/API into a codebase, or onboarding customers. If a
request isn't about ClockNext, **ignore this skill entirely**.

## Non-negotiable rules (apply to every step)
1. **Human-in-the-loop. Never guess a write.** Confirm every model / entitlement / plan /
   customer / purchase before creating it. **You may NEVER invent or auto-assign an
   `agentKey`** — it is always chosen by the user from real, already-created entitlements.
2. **Hard stop before spending money.** A **purchase raises a real invoice**, and on a LIVE
   org that is real money. NEVER create a customer, purchase, or fire a real (non-dry-run)
   signal without an **explicit, separate go-ahead for that step** — spell out exactly what
   becomes real ("this creates a customer and a $X invoice on your live org") and wait. Do
   NOT roll into customer/testing on your own momentum.
3. **UI-first; MCP is the fallback — and never forget the UI.** For creating and pricing
   credits / outcomes / units / plans, the **dashboard is the first-class path** (live price
   preview, records the full model bundle). Lead with the link every time. If the user says
   "do it via MCP," you may drive the MCP tool — but keep offering the UI as the cleaner
   option and fall back to it the moment pricing gets fiddly. Choosing MCP once does not mean
   "MCP forever." Links: `references/ui-links.md`.
4. **Pricing is always model-grounded — never a hand-typed number.** A credit / outcome
   price is computed from a **model mixer** (enabled model + avg tokens + input/output/cache
   split + margin). The MCP `create_credit` / `create_outcome` tools take that mixer and
   compute the price for you; the dashboard does it with a live preview. Never create a
   token-metered entitlement with a made-up base price.
5. **Don't stage things inactive as a ritual.** Once the user has confirmed a design, create
   it **active**. Do NOT create-inactive-then-activate as a two-step — that's friction, not
   safety (safety comes from rules 1–2). Only build inactive if the user explicitly wants to
   review it first, or asks for a draft.
6. **Sandbox is the recommended default, not a mandate.** `clocknext_whoami` tells you
   sandbox vs live — say which out loud. Offer to build+test on sandbox first. If the user
   chooses to work on live, **respect it** and proceed normally (rules 1–2 are the guardrails)
   — don't nag, and don't compensate with inactive-staging.
7. **Meter every billable call.** Surf the *entire* codebase for LLM/API calls — miss none.
8. **Docs are the source of truth.** Before you explain a ClockNext concept or write
   integration code, `clocknext_search_docs` → `clocknext_get_doc`. Never rely on memory.
9. **JS/TS codebase → `@clocknext/sdk`. Any other language → the REST API.** Decide once.
10. **The `cnk_` API key is a server-side secret** — env / secret store only, never
    client-side, never committed.
11. **Re-derive state on re-entry; be idempotent.** This flow spans many turns. On resume,
    read current state from the tools (`list_models`, `list_credits`, …). If an entitlement
    already exists (even inactive/parked), **reactivate it** — `update_credit`/`_unit`/
    `_outcome` with `isActive:true` (a full rewrite; send the current values + the flag).
    Do NOT loop reactivate-vs-create, and NEVER create a second entitlement on an agentKey
    that's already taken — agentKeys are unique org-wide.
12. **Ask like a human, not a schema.** Every question you put to the user must read as plain,
    natural language a finance/ops person understands with zero knowledge of ClockNext's
    internals — never make a raw field the question. Don't ask *"which agentKey does this map
    to?"* or *"ADVANCE or ARREAR?"*; ask *"which of these should this charge against?"* (list
    the entitlements by their real names) or *"bill this up-front for the whole cycle, or meter
    it as it's used?"*. Show the real options by name, ask in words, then map the answer to the
    underlying field / `agentKey` yourself. Terms like `agentKey`, `marginPercent`,
    `billingMode`, and the input/output/cache split are for you and the MCP — keep them out of
    what you ask the user.

## The flow

### 0 — Orient
- `clocknext_whoami` → which organisation, and **sandbox or live?** Say it out loud, and if
  live, offer sandbox (rule 6) — then respect the choice.
- `clocknext_list_models`, `clocknext_list_credits/_outcomes/_units/_plans` → what already
  exists (don't assume empty).
- **Surf the codebase** for the model(s) and provider(s) it actually calls.

### 1 — Models
For each model the code uses → `clocknext_add_model` (provider + catalog id). Report which
models were enabled.
- If the tool returns a **`warning` that the model has no catalog price**: tell the user
  *"the provider doesn't publish pricing for {model} — [click here]({base}/settings/models)
  to set it"* and **STOP** until they confirm it's priced.
- Model/provider **not in the catalog** → it can't be metered; help them pick a supported one.

Details: `references/pricing-and-models.md`.

### 2 — Entitlements (repeat until the user is happy)
First **reconcile with what exists** (rule 11) — reactivate/adjust before creating new.
Explain the **three** types and their fit, then ask which they want (several is fine):
- **Credit** — token-metered balance, drawn down per call by real token cost. For variable,
  token-shaped usage (chat turns, generations).
- **Outcome** — billed per *completed* multi-LLM-step deliverable. Every step is an LLM step;
  a **non-LLM / fixed-cost event is a UNIT, not an outcome step.**
- **Unit** — fixed price per *event*, no tokens (an upload, an export, a seat). Priced FLAT
  or tiered. **FLAT lives here.**

For each chosen entitlement:
- **Give the dashboard create link first** (`{base}/credits`, `{base}/outcomes`,
  `{base}/units`), then *"…or I can drive it via MCP."*
- Via MCP: pricing uses the **model mixer** (`models`: enabled model + avg tokens +
  input/output/cache split, + `marginPercent`) — the tool computes the grounded price. If it
  gets fiddly, go back to the UI (rule 3).
- Confirm each, then ask "another?" **Loop until satisfied.**

> **Wallet** isn't one of the three — it's a plan component: prepaid USD debited at raw model
> cost. Say it plainly: **wallet carries no margin — no profit on wallet spend.** Unit-FLAT
> (per event) ≠ plan-FLAT (one-off). Full breakdown: `references/entitlements.md`.

### 3 — Plan
A plan bundles entitlements (+ optional WALLET / FLAT components) and sets what a customer
pays. **Give `{base}/plans` first**, then offer MCP. Ask for **every** detail: billing cycle,
currency, each component's billing mode (ADVANCE up-front vs ARREAR metered) and quantity.
Confirm the composition, then create it **active** (rule 5) — unless they asked to review.

### 4 — Customer + code  ⛔ REAL-MONEY GATE
**Before anything here, STOP and get an explicit go-ahead (rule 2).** State it plainly:
*"Next I'll create a customer and subscribe it to the plan — on your LIVE org that raises a
real $X invoice (auto-payment off, so no card is charged, and we can void it). Proceed?"*
Only after an explicit yes:

**Path 1 — Quick test with a dummy customer:**
1. `clocknext_create_customer` (obvious throwaway) → confirm → `clocknext_create_purchase`
   onto the plan (this is the invoice-raising step — it must be the confirmed one).
2. **Surf the codebase; meter every billable call.** For **each** call, show the real
   entitlements **by name** (`list_credits`/`_outcomes`/`_units`) and **ask the user which one
   this call should charge against** — never infer (rules 1 & 12). Internally that's its
   `agentKey`; don't put the key in the question. Outcomes map to the *step*. **Write the
   integration the recipe way
   (`references/code-metering.md`): one singleton client in async mode + `onError`, thin
   per-meter helpers, one line each. Do NOT hand-roll a `mode:"sync"` + `try/catch` wrapper —
   async mode already never throws to the caller and doesn't block the request.**
3. Put the `cnk_` key in the server env.
4. **Run-down test:** `clocknext_verify_signal` (dry run) → then, with a go-ahead, a real
   call → `clocknext_get_customer_usage` / `_balances` / `_unit_usage` to confirm it landed.
5. Offer to void the test invoice / delete the dummy customer when done.
6. Then ask: **"Wire real customer onboarding now?"**

**Path 2 — Real onboarding:** add a `clocknextCustomerId` column to the tenant/user table;
create a ClockNext customer on signup; backfill; then the same metering + testing.

How-to: `references/code-metering.md` and `references/testing.md`.

## Units are NOT LLM calls
"Meter every LLM call" is about **credit / outcome / wallet** signals (token-priced). A
**unit is a per-event meter** — one event = one unit, no tokens. Meter units **in the
customer's product** via `signals.unit()` (SDK) or `POST /api/v1/units` (REST) — **never
through the MCP.** The MCP builds the catalogue; it does not do the product's runtime metering.
