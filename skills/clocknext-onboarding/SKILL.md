---
name: clocknext-onboarding
description: Guide a product end-to-end onto ClockNext usage-based billing using the ClockNext MCP tools — detect and enable the models it uses, create entitlements (credits / outcomes / units) and a plan, then meter every billable call in the codebase and prove it with a dummy customer and live signals. Fully human-in-the-loop: for every setup step the user chooses to do it Manually (in the ClockNext dashboard) or Automatically via the MCP, and a hard stop guards anything that spends real money. Use whenever the user is doing anything with ClockNext — setting up billing, creating or pricing credits/outcomes/units/plans, adding models, metering or charging for LLM/API calls, wiring agentKey or customerId into their app, or onboarding customers. If the request has nothing to do with ClockNext, ignore this skill.
---

# Onboard a product onto ClockNext usage-based billing

Take a product from "nothing metered" to "billed, tested, and live" with ClockNext, one
confirmed step at a time. Everything the MCP writes is **real org state** — and a purchase
raises a **real invoice** — so this is a slow, human-in-the-loop process: you propose, you
explain *why*, the user decides, and for each build step the user picks **how** it happens.

## When this runs
Any ClockNext work: setting up billing, adding models, creating/pricing entitlements or
plans, metering calls, wiring the SDK/API into a codebase, or onboarding customers. If a
request isn't about ClockNext, **ignore this skill entirely**.

## Manually vs Automatically via MCP — the choice you offer at every build step
Every time you're about to **create or change org state** (enable a model, create/price a
credit / outcome / unit, build a plan, create a customer, subscribe them), you don't just do
it and you don't just link out — you **offer the user both ways and let them pick**:

- **Manually** — the user does it themselves in the ClockNext dashboard. You give the exact
  deep-link (`references/ui-links.md`) **and spell out precisely what to enter**, then wait
  for them to say it's done before continuing.
- **Automatically via MCP** — you do it for them by calling the MCP tool, **after** confirming
  every specific in plain language.

Always present it as a real either/or, e.g. *"I can set this credit up two ways — you do it
**manually** in the dashboard (I'll give you the link and the exact numbers to enter), or I
do it **automatically via the MCP** right here. Which do you prefer?"* Then **say which you'd
lean toward and why** so the choice is informed — don't make them guess the tradeoff:

- For **pricing** (credits, outcomes), lean **Manually**: the dashboard shows a **live price
  preview** and, crucially, **records the full per-model pricing bundle** on the entitlement,
  which the MCP path cannot (the MCP grounds and stores only the final computed number). That
  richer record makes later re-pricing and auditing far easier. Say this reason out loud.
- For **mechanical, low-judgement** steps (enabling a known catalog model, creating a
  throwaway test customer), Automatic via MCP is usually the faster, cleaner pick.

Whatever they choose, **respect it for that step without re-litigating** — picking Automatic
once doesn't need re-justifying, and picking Manual once doesn't lock them in for the next
step. Ask fresh, briefly, per step.

## Non-negotiable rules (apply to every step)
1. **Narrate every move: say what you're about to do and WHY before you do it.** The user is a
   finance/ops person, not a ClockNext engineer — a step they don't understand is a step they
   can't approve. One plain sentence of purpose before each action ("I'm enabling the models
   first because every credit/outcome price is grounded in their live per-token rates —
   nothing downstream can be priced until they exist"). No silent tool calls that change state.
2. **Human-in-the-loop. Never guess a write.** Confirm every model / entitlement / plan /
   customer / purchase before creating it, and let the user pick Manual vs Automatic (above).
   **You may NEVER invent or auto-assign an `agentKey`** — it is always chosen by the user
   from real, already-created entitlements.
3. **Hard stop before spending money.** A **purchase raises a real invoice**, and on a LIVE
   org that is real money. NEVER create a customer, purchase, or fire a real (non-dry-run)
   signal without an **explicit, separate go-ahead for that step** — spell out exactly what
   becomes real ("this creates a customer and a $X invoice on your live org") and wait. Do
   NOT roll into customer/testing on your own momentum.
4. **Pricing is always model-grounded — never a hand-typed number.** A credit / outcome price
   is computed from a **model mixer** (enabled model + avg tokens + input/output/cache split +
   margin). Whichever way the user picks, the price comes from that mixer: the dashboard
   computes it with a live preview (Manual), and the MCP `create_credit` / `create_outcome`
   tools compute it from the same mixer (Automatic). Never create a token-metered entitlement
   with a made-up base price.
5. **Don't stage things inactive as a ritual.** Once the user has confirmed a design, create
   it **active**. Do NOT create-inactive-then-activate as a two-step — that's friction, not
   safety (safety comes from rules 2–3). Only build inactive if the user explicitly wants to
   review it first, or asks for a draft.
6. **Sandbox is the recommended default, not a mandate.** `clocknext_whoami` tells you
   sandbox vs live — say which out loud, and *why it matters* (live bills for real; sandbox is
   a disposable twin). Offer to build+test on sandbox first. If the user chooses live,
   **respect it** and proceed normally (rules 2–3 are the guardrails) — don't nag.
7. **Meter every billable call.** Surf the *entire* codebase for LLM/API calls — miss none. A
   missed call is silently un-billed revenue; say that's why you're being exhaustive.
8. **Docs are the source of truth.** Before you explain a ClockNext concept or write
   integration code, `clocknext_search_docs` → `clocknext_get_doc`. Never rely on memory —
   the docs are more current than training data.
9. **JS/TS codebase → `@clocknext/sdk`. Any other language → the REST API.** Decide once, by
   inspecting the codebase, and say which and why.
10. **The `cnk_` API key is a server-side secret** — env / secret store only, never
    client-side, never committed.
11. **Re-derive state on re-entry; be idempotent.** This flow spans many turns. On resume,
    read current state from the tools (`list_models`, `list_credits`, …) instead of assuming.
    If an entitlement already exists (even inactive/parked), **reactivate it** —
    `update_credit`/`_unit`/`_outcome` with `isActive:true` (a full rewrite; send the current
    values + the flag). Do NOT loop reactivate-vs-create, and NEVER create a second
    entitlement on an agentKey that's already taken — agentKeys are unique org-wide.
12. **Ask like a human, not a schema.** Every question must read as plain language a
    finance/ops person understands with zero knowledge of ClockNext's internals — never make a
    raw field the question. Don't ask *"which agentKey does this map to?"* or *"ADVANCE or
    ARREAR?"*; ask *"which of these should this charge against?"* (list the entitlements by
    their real names) or *"bill this up-front for the whole cycle, or meter it as it's used?"*.
    Show the real options by name, ask in words, then map the answer to the underlying field /
    `agentKey` yourself. Terms like `agentKey`, `marginPercent`, `billingMode`, and the
    input/output/cache split are for you and the MCP — keep them out of what you ask the user.

## The flow

### 0 — Orient  *(why: you can't safely build until you know which org you're in and what already exists)*
- `clocknext_whoami` → which organisation, and **sandbox or live?** Say it out loud — and why
  it matters (live = real invoices). If live, offer sandbox first (rule 6), then respect the choice.
- `clocknext_list_models`, `clocknext_list_credits/_outcomes/_units/_plans` → what already
  exists, so you reconcile instead of duplicating (rule 11). Don't assume the org is empty.
- **Surf the codebase** for the model(s) and provider(s) it actually calls — that's the ground
  truth for what to enable and meter.

### 1 — Models  *(why: pricing everything downstream is grounded in live per-token model rates — models must exist and be priced first)*
For each model the code uses, it must be enabled in the org. Offer the choice:
- **Manually** → send them to `{base}/settings/models` and tell them which provider + model to
  enable.
- **Automatically via MCP** → `clocknext_add_model` (provider + catalog id).

Then report which models are enabled. Two things to watch, and tell the user why each matters:
- **No catalog price** (the MCP returns a `warning`, or the dashboard shows $0): the provider
  doesn't publish pricing for that model, so **usage would meter at $0** — real usage, zero
  revenue. Send them to `{base}/settings/models` to set it and **STOP** until they confirm.
- **Not in the catalog** at all → it can't be metered; help them pick a supported model.

Details: `references/pricing-and-models.md`.

### 2 — Entitlements (repeat until the user is happy)  *(why: entitlements are what you actually sell — they define how usage turns into money)*
First **reconcile with what exists** (rule 11) — reactivate/adjust before creating new.
Explain the **three** types and their fit *in terms of the user's product*, then ask which
they want (several is fine). The map + a which-one decision guide is
`references/entitlements.md`; each has a deep reference (pricing math, tool fields, worked
examples) — open it before you price or explain that type:
- **Credit** — token-metered balance, drawn down per call by real token cost. For variable,
  token-shaped usage (chat turns, generations). Deep: `references/credit.md`.
- **Outcome** — billed per *completed* multi-LLM-step deliverable. Every step is an LLM step;
  a **non-LLM / fixed-cost event is a UNIT, not an outcome step.** Deep: `references/outcome.md`.
- **Unit** — fixed price per *event*, no tokens (an upload, an export, a seat). Priced FLAT
  or tiered (SLAB vs VOLUME differ a lot — see the worked table). **FLAT lives here.**
  Deep: `references/unit.md`.

For each chosen entitlement, offer the choice and say why you'd lean a given way:
- **Manually** — `{base}/credits` / `{base}/outcomes` / `{base}/units`. Lean this way for
  credits/outcomes: the live preview + stored model bundle make pricing safer and re-pricing
  easier (rule on pricing above). Spell out the mixer values to enter.
- **Automatically via MCP** — `create_credit` / `create_outcome` (model mixer → grounded
  price) / `create_unit`. Clean for simple/flat cases; note it stores the computed price only.
- Confirm each, then ask "another?" **Loop until satisfied.**

> **Wallet** isn't one of the three — it's a plan component: prepaid USD debited at raw model
> cost. Say it plainly: **wallet carries no margin — no profit on wallet spend.** Unit-FLAT
> (per event) ≠ plan-FLAT (one-off). A wallet can also *fund metered usage* — see the
> wallet-funded-arrear option in step 3 (`walletFundedArrear`). Deep: `references/wallet.md`.

### 3 — Plan  *(why: the plan is what a customer actually subscribes to — it bundles the entitlements and sets what they pay)*
A plan bundles entitlements (+ optional WALLET / FLAT components) and sets the price. Offer
the choice — **Manually** at `{base}/plans` (the plan builder, recommended for anything
non-trivial) or **Automatically via MCP** (`create_plan`). Ask for **every** detail in plain
words: billing cycle, currency, and for each component whether it's billed up-front for the
cycle or metered as used (ADVANCE vs ARREAR — but ask it in words, rule 12) and any quantity.
If the plan has both a prepaid wallet AND metered usage, offer **wallet-funded metering** in
plain words — *"pay that metered usage straight out of the prepaid wallet as it's used (one
bill a cycle; the wallet can dip negative and the next top-up covers it), instead of a separate
end-of-cycle usage invoice?"* — and if they say yes, set `walletFundedArrear:true`. It only
works when the plan has a metered (ARREAR) credit/outcome/unit AND an up-front (ADVANCE) wallet
(the backend rejects it otherwise), and remember wallet spend still carries no margin.
Confirm the composition, then create it **active** (rule 5) — unless they asked to review.

Details (components, ADVANCE vs ARREAR, cost composition, `priceAdjustment`): `references/plans.md`.

### 4 — Customer + code  ⛔ REAL-MONEY GATE  *(why: this is the first step that can cost real money — a purchase raises a real invoice)*
**Before anything here, STOP and get an explicit go-ahead (rule 3).** State it plainly:
*"Next I'll create a customer and subscribe it to the plan — on your LIVE org that raises a
real $X invoice (auto-payment off, so no card is charged, and we can void it). Proceed?"*
Only after an explicit yes:

**Path 1 — Quick test with a dummy customer:**
1. Create the customer (Manually at `{base}/customers`, or Automatically via
   `clocknext_create_customer` — an obvious throwaway) → confirm → subscribe it to the plan
   (`clocknext_create_purchase`). **This purchase is the invoice-raising step** — it must be
   the one the user explicitly approved. Say so as you do it.
2. **Surf the codebase; meter every billable call** (why: any call you miss is un-billed). For
   **each** call, show the real entitlements **by name** (`list_credits`/`_outcomes`/`_units`)
   and **ask the user which one this call should charge against** — never infer (rules 2 & 12).
   Internally that's its `agentKey`; don't put the key in the question. Outcomes map to the
   *step*. **Write the integration the recipe way (`references/code-metering.md`): one
   singleton client in async mode + `onError`, thin per-meter helpers, one line each. Do NOT
   hand-roll a `mode:"sync"` + `try/catch` wrapper — async mode already never throws to the
   caller and doesn't block the request.** Explain that choice so the user trusts the code.
3. Put the `cnk_` key in the server env (rule 10 — say why it's server-side only).
4. **Run-down test:** `clocknext_verify_signal` (dry run — prices without billing, so you
   catch a mis-wire safely) → then, with a go-ahead, a real call →
   `clocknext_get_customer_usage` / `clocknext_get_customer_balances` to confirm it landed and
   the balance moved. (Unit events aren't metered or read via the MCP — confirm units through
   their **balance** on `clocknext_get_customer_balances`, or in the dashboard.)
5. Offer to void the test invoice / delete the dummy customer when done.
6. Then ask: **"Wire real customer onboarding now?"**

**Path 2 — Real onboarding:** add a `clocknextCustomerId` column to the tenant/user table;
create a ClockNext customer on signup; backfill; then the same metering + testing.

How-to: `references/code-metering.md` and `references/testing.md`.

## Units are NOT LLM calls
"Meter every LLM call" is about **credit / outcome / wallet** signals (token-priced). A
**unit is a per-event meter** — one event = one unit, no tokens. Meter units **in the
customer's product** via `signals.unit()` (SDK) or `POST /api/v1/units` (REST) — **never
through the MCP.** The MCP builds the catalogue and reads balances; it does not do the
product's runtime metering, and it has no unit-usage recording or read tool.
