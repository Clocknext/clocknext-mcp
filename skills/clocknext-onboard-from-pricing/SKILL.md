---
name: clocknext-onboard-from-pricing
description: Set up ClockNext usage-based billing for a product that already has a pricing page. Point it at the product's pricing URL and it classifies the pricing (credit / outcome / unit based), creates the matching credits, outcomes, units, plans and models at a 30–40% margin, wires the ClockNext SDK or API into the codebase, and fires a test usage signal for a throwaway customer. Use when a customer wants to replicate their existing pricing in ClockNext, onboard, or "set up billing from my pricing page".
---

# Onboard ClockNext from an existing pricing page

Take a product's existing pricing page and reproduce it in ClockNext end to end: the
catalogue (credits / outcomes / units / plans / models), the codebase integration, and
one proven test signal. Everything the ClockNext MCP tools touch is **real org state**,
so confirm you're on a **sandbox** first, and confirm the pricing mapping with the user
before you create a whole plan family.

Work the steps in order.

## 0. Ground yourself (always first)

- `clocknext_whoami` → confirm the org, and that it is **`sandbox`** (not `live`). Do the
  whole setup on sandbox until it's proven.
- `clocknext_search_docs` (kind `concept`) for any term you're unsure of — "credit",
  "outcome", "unit", "plan component", "ADVANCE vs ARREAR" — then `clocknext_get_doc` the
  best hit for the full page. The docs are the source of truth; never guess ClockNext
  semantics, and never use an external web fetch for ClockNext docs.
- `clocknext_list_models` → see which models the org already has enabled.

## 1. Read the pricing page

- Fetch the pricing URL the user gave you (use your own web-fetch capability). If you
  can't fetch it, ask the user to paste the pricing tiers.
- Extract, per tier: name, price, billing cycle, and what's included (quotas, credits,
  seats, "X generations/mo", outcomes, overage rates, annual minimums).

## 2. Classify each included item → a ClockNext meter

- **Credit** — a consumable balance spent per action, often token-priced ("500 credits",
  "AI credits", "$X per 1k tokens"). → `clocknext_create_credit`.
- **Outcome** — billed per completed multi-step deliverable ("per resolved ticket",
  "per shipped app", "per successful deploy"). → `clocknext_create_outcome` + its steps.
- **Unit** — a metered usage unit, flat or tiered ("per seat", "per API call", "per GB",
  "per build minute"). → `clocknext_create_unit`.
- **Wallet** — a prepaid USD balance drawn down → a WALLET plan component.
- **Flat** — a fixed recurring / one-off fee → a FLAT plan component.

For a lovable.dev-style product (credits for AI generations): usually **credit-based**,
sometimes plus a **seat unit** and an **outcome** for shipped apps. Split outcome-based
pricing into its own plan family rather than cramming it into a credit tier.

## 3. Price at a 30–40% margin

For each credit / outcome / unit:
- `basePrice` = your real per-unit cost (model/provider cost or COGS).
- `marginPercent` = a value in **30–40** (default **35**).
- customer-facing price (`pricePerCredit` / `pricePerOutcome` / a unit tier `price`)
  = `basePrice × (1 + marginPercent/100)`.

If the page shows a customer price and you know the cost → back-solve `marginPercent` and
clamp to 30–40. If you only know the customer price → set it and estimate `basePrice` so
the margin lands in-band. **State your assumptions to the user.**

## 4. Models

- Work out which LLMs the product uses (from the site's pricing/marketing/docs). For each,
  `clocknext_add_model` with `provider` + `model` — it's **autopriced** from the catalog.
- If you can't tell, default to **`provider: "anthropic", model: "claude-sonnet-4-6"`**.
- `add_model` only works for models in ClockNext's catalog (and needs its endpoint
  deployed). If it errors (405 = not deployed; or "not in catalog"), tell the user to
  enable it in the dashboard (**Settings → Models**) and continue.

## 5. Build the catalogue bottom-up

Create referenced resources BEFORE the plans that use them:
1. `create_credit` / `create_outcome` / `create_unit` for every metered item from steps
   2–3. Capture each returned id — `create_credit` returns no body, so `list_credits` to
   find it.
2. `create_plan` per pricing tier: map the tier to `components[]` — WALLET/FLAT for base
   fees, and CREDIT/OUTCOME/UNIT components referencing the ids from step 1. Choose
   `billingMode`: **ADVANCE** (granted up-front, needs `quantity`) for included
   allowances, **ARREAR** (metered) for overage / pay-as-you-go. A FREE tier → a FREE
   plan (ADVANCE-only, no FLAT).
3. `get_plan` each one and check the price matches the pricing page.

## 6. Integrate the codebase

- **Detect the language.** **JS/TS** → use `@clocknext/sdk`; follow the
  **`clocknext-integration`** skill for the exact wiring (singleton client, meter every
  billable call, flush before serverless return).
- **Non-JS** (Python/Go/Ruby/…) → integrate against the **REST API**;
  `clocknext_search_docs kind=api` + `clocknext_get_doc` for the exact endpoints/fields.
- **Map the meters:** after each billable call, send the matching signal with the right
  `agentKey` (the credit's / outcome step's key), real token counts, and an
  `idempotencyKey`. Map the product's own user/tenant id → the ClockNext `customerId`.

## 7. Prove it — dummy customer + test signal

1. `clocknext_create_customer` — name it e.g. "Test — <product>", a throwaway email.
2. `clocknext_create_purchase` — subscribe that customer to one of the new plans. **This
   activates metering** (a signal only prices once the customer has an active plan whose
   components match the meter).
3. `clocknext_verify_signal` — dry-run it (records **nothing**) to confirm it prices.
4. `clocknext_record_usage` — fire ONE real test signal **for that dummy customer only**.
   Confirm it priced (no `PlanError`).
- Token-priced signals need the model enabled first (step 4); otherwise test a non-token
  meter first.

## 8. Hand off

Tell the user:
- What you created (credits/outcomes/units/plans/models) and the test-signal result.
- To go **live**: re-run against the live org (`whoami` shows `live`) or use the dashboard.
- **Next:** to link their real users, use the **`clocknext-customer-mapping`** skill (adds
  a `clocknextCustomerId` column + create-on-signup). To backfill an existing user base,
  use the **`clocknext_bulk_import_customers`** MCP tool (array ≤200, matched back by email).

## Guardrails

- **Sandbox first, always.** Never create on `live` without explicit confirmation.
- Confirm the pricing mapping with the user before creating a plan family — get the money
  right.
- Every write is real org state and there's no bulk undo. To reverse, **archive** (not
  delete) — `archive_plan` / `_credit` / `_outcome` / `_unit`.
