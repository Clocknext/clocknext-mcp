---
name: clocknext-setup-billing
description: Set up ClockNext usage-based billing for a product end to end. Two entry points — (1) the customer gives their pricing page/plan (and optionally their codebase) → classify each line as credit / outcome / unit, price it from the model cost at a sensible margin, create the credits/outcomes/units/plans/models, then wire the SDK/API into the codebase; (2) the catalogue already exists in ClockNext → skip straight to integrating the codebase. Both paths meter every billable call, then create a throwaway dummy customer, fire a test signal, and confirm it landed. Use when the user asks to onboard, replicate/copy their pricing into ClockNext, set up usage-based billing, meter or charge per API/LLM call, or wire ClockNext into their app.
---

# Set up ClockNext usage-based billing (pricing → catalogue → code → test signal)

Reproduce a product's billing in ClockNext and prove it works. Everything the ClockNext
MCP tools write is **real org state**, so stay on **sandbox** until it's proven, and
confirm the pricing mapping with the user before creating a plan family.

Pick the entry point:

- **A — Replicate from pricing (+ codebase).** The customer gives a pricing page/plan and
  (usually) their codebase. Do Phase 1 → 2 → 3 → 4.
- **B — Catalogue already exists.** Plans / credits / units / outcomes are already set up in
  ClockNext. **Skip Phase 1**; do Phase 2 → 3 → 4 (start from the codebase).

Work the phases in order.

## Phase 0 — Ground yourself (always first, both entry points)

- `clocknext_whoami` → confirm the org and that it is **`sandbox`** (not `live`). Do the
  whole setup on sandbox until proven.
- `clocknext_search_docs` (kind `concept`) for any term you're unsure of — "credit",
  "outcome", "unit", "plan component", "ADVANCE vs ARREAR" — then `clocknext_get_doc` the
  best hit. The docs are the source of truth; never guess ClockNext semantics and never use
  an external web fetch for ClockNext docs.
- `clocknext_list_models` → which models the org already has enabled, and their prices.

## Phase 1 — Replicate the pricing into a catalogue  *(entry A only)*

### 1a. Read the pricing and pin down the model
- Read the pricing the customer gave you (fetch the URL with your own web-fetch, or use the
  pasted tiers). Extract per tier: name, price, billing cycle, and everything included
  (credits, "X generations/mo", seats, projects, build minutes, outcomes, overage rates).
- **Find the model + provider** the product runs on — from their pricing/docs/marketing or
  the codebase. If you can't determine it, **ASK the user for the provider + model** (don't
  guess). The model sets the base cost for token-priced meters.

### 1b. Classify each included item → a ClockNext meter, then CONFIRM
Map every line item to exactly one meter, then **state your mapping and the reason and ask
the user to confirm before creating anything**, e.g. *"I've modelled 'AI credits' as a
credit-based meter because it's a consumable balance spent per LLM call; '5 active projects'
as a unit because it's a non-LLM capacity limit. Confirm?"*

- **Credit** — a consumable balance spent per LLM action, usually token-priced ("500
  credits", "AI credits", "$X / 1k tokens"). → `clocknext_create_credit`.
- **Outcome** — billed per completed multi-step deliverable ("per resolved ticket", "per
  shipped app", "per successful deploy"). → `clocknext_create_outcome` + its steps.
- **Unit** — a **non-LLM** metered quantity, flat or tiered ("5 active projects", "2
  concurrent builds", "per seat", "per GB", "per build minute"). → `clocknext_create_unit`.
- **Wallet** — a prepaid USD balance drawn down → a WALLET plan component.
- **Flat** — a fixed recurring / one-off fee → a FLAT plan component.

Rule of thumb: **LLM/token consumption → credit or outcome; non-LLM capacity/usage → unit.**

### 1c. Price it — two different prices, don't conflate them
- **Per-meter unit price** (per-credit / per-outcome / per-unit tier) = your real cost +
  margin.
  - For token-priced credits/outcomes, `basePrice` = the **model cost** (from
    `clocknext_list_models`).
  - For non-LLM **units**, `basePrice` = your COGS / a sensible estimate, priced by simple
    math (e.g. cost per build-minute × minutes).
  - `marginPercent` = a **reasonable** margin — default **~35%**, keep it in a sane band
    (roughly 30–40%). **State your assumptions to the user.**
- **Plan price** = the price on the pricing page — **copy it verbatim; do NOT recompute it
  from cost.** Your margin already lives in the per-meter prices above.
  - Example: the "Pro" tier grants **25 credits** that cost you ~**$10**, and the page sells
    Pro at **$25/mo** → set the plan's subscription price (WALLET/FLAT component) to **$25**
    and price the credit itself off model cost + margin. Keep the $25.

### 1d. Models
- For each model the product uses, `clocknext_add_model` with `provider` + `model` —
  autopriced from the catalog.
- If you can't tell which model, **ask the user**; if still unknown, default to
  `provider: "anthropic", model: "claude-sonnet-4-6"` and say so.
- `add_model` only works for catalog models on a deployed endpoint. On error (405 = not
  deployed; "not in catalog"), tell the user to enable it in **Settings → Models** and continue.

### 1e. Build the catalogue bottom-up
Create referenced resources BEFORE the plans that use them:
1. `clocknext_create_credit` / `_create_outcome` / `_create_unit` for every metered item.
   Capture each returned id — `create_credit` returns no body, so `clocknext_list_credits`
   to find it.
2. `clocknext_create_plan` per tier: map to `components[]` — WALLET/FLAT for the base fee
   (the page price from 1c), CREDIT/OUTCOME/UNIT components referencing the ids from step 1.
   Choose `billingMode`: **ADVANCE** (granted up-front, needs `quantity`) for included
   allowances, **ARREAR** (metered) for overage / pay-as-you-go. A FREE tier → a FREE plan
   (ADVANCE-only, no FLAT).
3. `clocknext_get_plan` each and check the numbers match the pricing page.

## Phase 2 — Integrate the codebase  *(both entry points; entry B starts here)*

Only run this if the customer gave you a codebase. If not, hand them the snippets and skip
to Phase 3.

- **Detect the language.** JS/TS → `@clocknext/sdk`; non-JS (Python/Go/Ruby/…) → the REST
  API (`clocknext_search_docs kind=api` + `clocknext_get_doc` for exact endpoints/fields).
- **Install + configure (JS/TS).** `npm i @clocknext/sdk`; instantiate **once** (module
  singleton) from a server-side secret:
  ```ts
  import { ClockNext } from "@clocknext/sdk";
  const cnk = new ClockNext({ apiKey: process.env.CLOCKNEXT_API_KEY! });
  ```
- **Find every billable call.** Search the repo for provider SDK calls (openai / anthropic /
  etc.) and any non-LLM billable action (project created, build started). Right after each
  returns, record the matching signal:
  ```ts
  await cnk.signals.credit({
    customerId,                        // ClockNext customer id for this end-user
    model: "gpt-4o",                   // a modelId from clocknext_list_models
    agentKey: "pro_credit",            // the Credit's / outcome step's / unit's key
    tokens: { input: usage.prompt_tokens, output: usage.completion_tokens },
    idempotencyKey: requestId,         // reuse across retries of THIS call
  });
  ```
  - `tokens.input` and `tokens.output` are **required**; `tokens.cache` is optional. Pull
    counts from the provider's `usage` (OpenAI `prompt_tokens`/`completion_tokens`;
    Anthropic `input_tokens`/`output_tokens`).
  - Always pass a stable **`idempotencyKey`** so a retry can't double-bill.
- **Attribute correctly — ask when ambiguous.** If the plan has **multiple credits or
  outcomes**, don't guess which call maps to which: **ask the customer** where each
  credit/outcome should be recorded. For **units** (non-LLM), find the place in the code
  where that action happens (project created, build started) and record the unit there — if
  you can't locate it, **ask the customer** to point you at it.
- **Don't lose signals on serverless.** `await cnk.flush()` before a serverless handler
  returns / on shutdown, or pass `{ wait: true }` on a single call to send synchronously.

## Phase 3 — Prove it: dummy customer + test signal + confirm it landed

1. `clocknext_create_customer` — name it e.g. "Test — <product>", throwaway email.
2. Put that customer id in the app's env (e.g. `CLOCKNEXT_TEST_CUSTOMER_ID`) and
   `clocknext_create_purchase` to subscribe it to one of the plans. **This activates
   metering** — a signal only prices once the customer has an active plan whose components
   match the meter. Confirm it took with `clocknext_get_customer_plan`.
3. `clocknext_verify_signal` — dry-run (records nothing) to confirm it prices with no `PlanError`.
4. Fire ONE real test signal **for the dummy customer only**, either:
   - `clocknext_record_usage` (fastest — returns the priced `usageLog` inline, so this is
     self-verifying), **or**
   - run the relevant part of the codebase so it fires a real SDK signal.
5. **Confirm it landed.** If you ran the codebase (the signal flushes asynchronously), read
   it back and confirm the event arrived and drew the balance down:
   - `clocknext_get_customer_usage` (customerId, limit 5) → the recent usage rows; check the
     model, tokens, and cost match.
   - `clocknext_get_customer_balances` (customerId) → confirm the credit / unit / outcome
     drew down (or the wallet was debited).
   Token-priced signals need the model enabled first (Phase 1d); otherwise test a non-token
   meter first.

## Phase 4 — Hand off (say this to the customer)

Tell the customer, in these terms:

> Everything is wired up and a test signal priced correctly. Right now billing is running
> against a **dummy test customer** only. When you're ready:
> - To attach ClockNext to your real users, use the **`clocknext-customer-mapping`** skill —
>   it adds a `clocknextCustomerId` column to your user/tenant table and creates a ClockNext
>   customer on signup.
> - To migrate your **existing** customers, use bulk import — point me at your users table
>   and I'll pull them and add them to ClockNext (`clocknext_bulk_import_customers`, ≤200 per
>   call, matched back by email).
> To go **live**, re-run against the live org (`whoami` shows `live`) or use the dashboard.

## Guardrails

- **Sandbox first, always.** Never create on `live` without explicit confirmation.
- **Confirm the meter mapping and the margin with the user before creating a plan family** —
  get the money right; every write is real org state and there's no bulk undo.
- To reverse a mistake, **archive** (not delete): `archive_plan` / `_credit` / `_outcome` /
  `_unit`.
- The API key is a secret — server-side only, from env, never in client code.
