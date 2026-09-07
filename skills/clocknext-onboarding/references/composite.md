# Composite — several entitlements billed as ONE thing

A **composite** bundles credits / outcomes / units that already exist and bills them as a
single sellable thing. The customer is charged **once per occurrence of the bundle**, not
once per item inside it.

Use it when the product's own unit of work is bigger than any one meter. A "voice AI call"
might be a transcribe credit + a summarise credit + 4 minute-units — three meters, but the
customer buys *calls*. A composite is how "$2 per call" becomes the price instead of the sum
of three internal prices.

> **Naming:** the product word is *composite*. The stored enum and the plan-component wire
> value are still the older `PRICING_METRIC`. Same thing; don't be thrown by it.

## When to pick it
- Billing sounds like *"$X per call / per job / per document"* — where that one thing is
  made of **several metered steps you already model**.
- The customer should not see, or be charged for, the internal breakdown.
- You need a **prepaid pool** of those things ("100 calls a month") shared across whatever
  mix of credits/outcomes/units each call happens to use.

**Don't** pick it when a single meter already fits. One credit is a credit. A composite that
wraps one thing is just indirection.

**Don't** confuse it with an [outcome](outcome.md). An outcome is one deliverable made of
**LLM steps** and is billed per completed run. A composite is one deliverable made of
**entitlements of any kind** — including units and whole outcomes — and is billed per
completed occurrence. If every step is an LLM call, you want an outcome.

## The two-step money boundary — read this before creating one

Creating a composite **charges nobody**. An invoice is built from plan components, never
from a catalogue entry. There are two steps and both are required:

1. **`clocknext_create_composite`** — defines what the bundle is and what one occurrence
   costs.
2. **Sell it on a plan** — add a component of type `PRICING_METRIC` referencing the
   composite id, with a `billingMode` and (for ADVANCE) a `quantity`.

Say this out loud to the user. A composite that was created but never put on a plan bills
nothing, produces no error, and looks correctly configured — it is the single most likely
way for this feature to silently do nothing.

## Create it — `clocknext_create_composite`

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Human label, e.g. "Voice AI call". |
| `refId` | yes | The tag identity the product's code sends. Lowercased, `[a-z0-9._-]`, unique org-wide. **May not collide** with a field the ingest body owns (`customerId`, `usage`, `agentKey`, `runId`, `member`, `custom`, `composite`, …) — refused at create time. |
| `price` | yes | USD for **one completed occurrence**, once a plan sells it. Ask the user; never invent it. |
| `creditIds` / `outcomeIds` / `unitIds` | **at least one, combined** | What the bundle is made of. Pass **ids**, from `clocknext_list_credits` / `clocknext_list_outcomes` / `clocknext_list_units`. |
| `description` | no | Optional note. |

The entitlement set is the composite's **restriction**: only signals naming something in
that set may carry its tag. It is required precisely because a composite restricted to
nothing would absorb every signal in the organisation.

There is **no update and no archive** on the public API — both are dashboard-only. Confirm
`name` and `refId` with the user before creating, because you cannot fix either from here.

## The two billing modes

| Mode | `quantity` means | Behaviour |
| --- | --- | --- |
| **ADVANCE** | a **prepaid pool of slots** | Each distinct tag value claims one slot when its occurrence completes. Repeat signals under the same value reuse the slot already claimed, at no extra cost. The pool is **shared** across whichever wrapped items each occurrence used. Once every slot is claimed, further occurrences are refused rather than billed. The pool resets each cycle. |
| **ARREAR** | nothing prepaid | Completed occurrences are counted on the cycle-end line. |

## At runtime — two calls, and the second one is the one people forget

**1. Tag each signal** with the composite and your correlation value for this one occurrence:

```ts
const composite = { ref: "voice_ai", value: callId };   // callId = YOUR id for this call

await cnk.signals.credit({ customerId, model, agentKey: "transcribe", tokens, composite });
await cnk.signals.unit({ customerId, agentKey: "minutes", quantity: 4, composite });
```

Every signal sharing that `value` belongs to the same occurrence. The occurrence opens on
the first tagged signal and **costs nothing** while open.

**2. Close it** — this is the moment it bills:

```ts
await cnk.signals.completeComposite({ customerId, composite });
```

Put it on the line before the workflow's own `return`. Only the product's code knows when
the work ended, so closing is a **declaration**, never inferred from which signals have
arrived — tagged signals may arrive in any order and the occurrence stays open and unbilled
until you say so.

Both are safe to repeat: closing twice answers `ALREADY_COMPLETED` and cannot bill again.
Closing **early** is safe too — before every wrapped item has reported, or while an ADVANCE
pool is full, the server parks the request and applies it when the blocker clears.

### The outcome shortcut
An **outcome never needs step 2**. Its own `complete: true` closes its run *and* the matching
composite occurrence together. Mind the edge: if the outcome is the last thing to report, the
occurrence ends at the outcome rather than at the workflow's real boundary. When the tag
should span the whole workflow, send the outcome steps **without** `complete: true` and close
the composite yourself instead.

### A wallet signal cannot be tagged
Composites group entitlement traffic; raw wallet spend is metered as money, not entitlement.
The server accepts a tag on a wallet signal and **ignores** it, so passing one implies a
rollup that will never exist.

## Preflight it
`clocknext_verify_signal` takes `compositeRef` + `compositeValue`, so you can confirm the tag
resolves before wiring real traffic. Send **both or neither** — half a tag is rejected rather
than silently dropped.

Check the refId with `clocknext_list_composites` first. A tag naming no live composite is
**silently ignored, not rejected** — the signal bills normally and the rollup just never
happens, so a typo reads exactly like success.

## Gotchas
- **Created but not on a plan → bills nothing, silently.** The most common failure.
- **A typo'd `refId` at runtime is invisible.** Nothing errors; the occurrence never exists.
- **Renaming a `refId`** (dashboard only) keeps all history — rows bind by id — but cuts
  ingest over immediately, so callers still sending the old property stop being counted with
  no error. Ship the new property to callers first, then rename.
- **One composite per signal** through the SDK's `composite: { ref, value }`. The wire format
  accepts several; the typed helper expresses one.
- **`price` is not re-derived.** Unlike a credit's model-grounded price, nothing re-sums the
  wrapped items' prices server-side. What you pass is what one occurrence costs.
