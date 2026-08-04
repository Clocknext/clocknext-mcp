# Entitlement types — credit vs outcome vs unit (and wallet, flat)

ClockNext has **three catalogue entitlements** you create and price, plus two plan-level
components (wallet, flat). Ground everything in the docs (`clocknext_search_docs kind=concept`)
before explaining — this is a summary, not the source of truth.

## Credit
A **token-metered balance**. Each billable call draws credits down in proportion to its real
token cost. Use when pricing is "credits" / "tokens" / general metered AI usage.
- Priced from a **model bundle**: pick enabled model(s), a token volume + input/output/cache
  split; that gives a base price; a **margin %** on top gives the price per credit.
- Runtime signal: `signals.credit({ agentKey, model, tokens })`.

## Outcome
Billed per **completed deliverable** made of 1–50 **steps**. You charge when the outcome
completes, not per call. Use for "per workflow / per job / per result" pricing — e.g. "$5 per
contract reviewed", where review = extract → analyse → summarise.
- Each **step** has its own `agentKey` and its own base-price bundle; the outcome's base price
  is the sum of step base prices, + margin.
- Runtime signal: `signals.outcome({ agentKey: <step key>, model, tokens })` — one call
  advances one step.

## Unit
A **fixed price per event, no tokens.** Seats, reports generated, actions taken — anything
that isn't token-shaped. **This is where FLAT lives.** Unit pricing options:
- **FLAT** — one price per event (`flatPrice`). The default, simplest unit.
- **SLAB** — tiered; each tier's rate applies only to the volume within that tier.
- **VOLUME** — tiered; the tier the total lands in sets the rate for all of it.
- 1–50 tiers for SLAB/VOLUME; only the last tier may be unbounded.
- Runtime signal: the **customer's product** calls `signals.unit({ agentKey })` (SDK) or
  `POST /api/v1/units` (REST) — one call = one unit. **Never metered via the MCP.**

## Wallet (plan component — NOT a catalogue entitlement)
A **prepaid USD balance** debited at the **raw model cost**. State it plainly to the user:
**wallet carries NO margin — you make no profit on wallet spend.** It's pure pass-through
cost ("top up $X, burn it down at cost"). Add it as a plan component, not via the catalogue.

## Flat (plan component)
A one-off fee on the plan (e.g. a setup fee). Do not confuse with a **unit** priced FLAT: the
unit-FLAT is charged **per event**; the plan-FLAT is a **single** charge on the plan.

## Mixed / multiple
A product can use several entitlements and more than one of each — e.g. a "chat" credit + a
"reports" unit + a "contract-review" outcome. Create them one at a time, confirming each, and
loop until the user says the catalogue is complete.
