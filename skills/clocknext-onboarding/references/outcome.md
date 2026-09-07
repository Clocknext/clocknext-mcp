# Outcome — billed per completed deliverable

An **outcome** is a catalogue entitlement for a **multi-step LLM deliverable** that you charge
for **once, when it completes** — not per call. Think "$5 per contract reviewed", where a review
is several LLM steps (extract → analyse → summarise).

## When to pick it
- Billing sounds like *"per job / per workflow / per result / per document processed."*
- The unit of value is a **finished deliverable** made of **multiple LLM steps**.
- You want to charge a single price for the whole thing regardless of exact token use.

If it's one token-metered call, use a [credit](credit.md). If a step is a **non-LLM, fixed-cost**
event (an upload, an export), that's a [unit](unit.md) — **not** an outcome step.

## Create it — `clocknext_create_outcome`

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Human label. |
| `agentKey` | yes | The **outcome's own** stable key. Unique org-wide, `[a-z0-9._-]`. |
| `marginPercent` | yes | Markup over the **summed** step base costs. `100` = double. |
| `steps` | yes | **1–50 steps.** Each has its own `name`, its own `agentKey`, and its own **model mixer** (`models`). |
| `description` | no | Optional. |
| `isActive` | no | Sellable or not. |

> **Two different agent keys — don't conflate them.** The outcome carries its own
> `agentKey` (its identity, mirroring a credit's), and every step carries its own. They live
> in **separate namespaces** and both must be unique across the organization. Usage is always
> reported against a **step's** key — never the outcome's. Omitting the outcome-level
> `agentKey` fails with a `400 ValidationError`.

Each step is priced from its own mixer (same mechanics as a [credit](credit.md)); the tool sums
the step base prices and applies the margin. A step that prices to **$0 is rejected** — give it
real token usage, or model it as a [unit](unit.md) if it's a fixed-cost, non-LLM event.

## Pricing mechanics (verified)

    stepBasePrice_i = the step's model-mixer provider cost (USD, no margin)   // see credit.md formula
    outcomeBasePrice = Σ stepBasePrice_i
    pricePerOutcome  = outcomeBasePrice × (1 + marginPercent/100)

### Worked example
Three steps, base costs **$0.10 + $0.05 + $0.15**, margin **25%**:

    outcomeBasePrice = 0.30
    pricePerOutcome  = 0.30 × 1.25 = $0.375   ← charged once per completed outcome

## Completion — how it actually bills (important)
Billing is **declared, never inferred**. At runtime the product advances steps by their
`agentKey`, tying them to one workflow **run**, and marks the final signal complete:
```ts
signals.outcome({ customerId, model, agentKey: "<step key>", tokens, runId, complete })  // SDK
// or POST /api/v1/signal/outcome  { customerId, agentKey, runId, complete?,
//                                   usage: { model, inputTokens, outputTokens, cacheTokens } }  (REST)
```
- Signals with `complete: false` are **attached to the run but cost nothing**.
- The signal carrying **`complete: true` closes the run and bills exactly `pricePerOutcome` once.**
- A duplicate `complete: true` is **idempotent** — no second charge.
- `clocknext_verify_signal` takes the same fields (`type:"outcome"` requires `runId` and
  accepts `complete`) — use it to price each step and confirm the keys resolve before wiring
  the product. It is a **dry run**: it never opens or closes a run, so it always reports
  `closedRun: false` even with `complete: true`, and its `customerCost` is that step's token
  cost — **not** `pricePerOutcome`. **A dry run cannot preview the completion charge**; read
  `pricePerOutcome` from `clocknext_get_outcome` instead. The MCP has no record-usage tool, so
  an actual run is only ever advanced and completed by the product's own SDK calls.

So partial / abandoned runs are free; you're paid only for finished outcomes.

## In a plan
Granted via an **OUTCOME component** referencing the outcome id:
- **ADVANCE** — prepay a `quantity` of outcomes.
- **ARREAR** — bill each completed outcome as it happens (optionally [wallet-funded](wallet.md)).
See [`plans.md`](plans.md).

## Common mistakes
- **Making a non-LLM step an outcome step.** Fixed-cost events are [units](unit.md).
- **Expecting per-step billing.** You're billed per *completed outcome*, once.
- **Forgetting `complete: true`.** Without it a run never bills — it stays open and free.
- **Non-unique step names / agent keys** within one outcome — each must be unique, and every
  `agentKey` must also be unique across the organization.
- **Forgetting the outcome's own `agentKey`**, or reusing a step's key for it. Both are
  required, both are org-wide unique, and they are not interchangeable.
- **Dropping `agentKey` on `clocknext_update_outcome`.** Update is a full rewrite, so pass
  the existing outcome key back (read it with `clocknext_get_outcome`) unless you truly mean
  to change the outcome's identity.
