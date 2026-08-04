# Pricing & models

## Enabling models (`clocknext_add_model`)
- Only **catalog** models can be metered. Give `provider` + `model` (its catalog id);
  ClockNext auto-prices from its catalog.
- **No catalog price?** The model still enables, but at **$0**, and the tool returns a
  `warning`. Send the user to `{base}/settings/models` to set the price, and **STOP** until
  they confirm it's set — otherwise usage meters at $0.
- **Not in the catalog** (unknown model/provider) → it can't be added or metered at all. Help
  the user pick a supported model; don't offer manual pricing (non-catalog models aren't
  supported).

## How a price is built — the model mixer (credits + outcome steps)
A credit / outcome-step price is **grounded in a model**, never typed by hand. You supply a
**mixer**: one or more enabled models, each with the **avg total tokens** it uses and an
**input / output / cache percentage split** (the three total 100). The base cost is those
tokens priced at the model's live per-1M-token rates, summed; then margin:

    basePrice       = Σ  avgTokens × (inputPct·inputPrice + outputPct·outputPrice + cachePct·cachePrice) / 1e6
    pricePerCredit  = basePrice × (1 + marginPercent / 100)
    pricePerOutcome = (Σ step basePrices) × (1 + marginPercent / 100)

Both paths compute this for you:
- **MCP** — `create_credit` takes `models: [{ model, avgTokens, inputPct, outputPct, cachePct }]`
  + `marginPercent`; `create_outcome` takes the same mixer **per step**. The tool reads live
  prices via `list_models`, computes the base + price, and **rejects a turned-off / unknown
  model or a split that isn't 100** — so an MCP-made entitlement is always model-grounded.
- **Dashboard** — the calculator does the same with a **live preview**, and additionally
  **stores the full per-model bundle** on the entitlement (the MCP path stores the computed
  price only). That richer record is why the UI is the first-class path.

## Why the UI is first-class for pricing
The MCP grounds the *number*, but only the **dashboard records the model bundle** on the
entitlement (the MCP can't — the bundle is keyed by an internal model id the public API
doesn't expose). So for auditability and later re-pricing, **lead with the UI link**
(`{base}/credits`, `{base}/outcomes`, `{base}/units`). Drive it via MCP only when the user
asks — and fall back to the UI the moment pricing gets fiddly.
