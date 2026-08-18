# Pricing & models

## Enabling models — Manually or Automatically via MCP
A model can be enabled either way, and you offer the user the choice (why: it must exist and
be priced before anything downstream can be priced against it):
- **Manually** → `{base}/settings/models`; tell them which provider + model to enable.
- **Automatically via MCP** → `clocknext_add_model` with `provider` + `model` (its catalog id).

Either way:
- Only **catalog** models can be metered. ClockNext auto-prices from its catalog.
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

Both ways the user can choose compute this for them — neither lets a raw price be typed:
- **Automatically via MCP** — `create_credit` takes
  `models: [{ model, avgTokens, inputPct, outputPct, cachePct }]` + `marginPercent`;
  `create_outcome` takes the same mixer **per step**. The tool reads live prices via
  `list_models`, computes the base + price, and **rejects a turned-off / unknown model or a
  split that isn't 100** — so an MCP-made entitlement is always model-grounded.
- **Manually in the dashboard** — the calculator does the same with a **live preview**, and
  additionally **stores the full per-model bundle** on the entitlement.

## Manual vs Automatic for pricing — how to help the user choose
Both ground the *number* in live model rates, so both are correct. The difference to explain:
only the **dashboard (Manual) records the model bundle** on the entitlement — the MCP can't,
because the bundle is keyed by an internal model id the public API doesn't expose, so the MCP
stores just the final computed price. That bundle is what makes later **re-pricing and
auditing** easy. So when the user is deciding, **recommend Manual for credits/outcomes and say
that reason out loud** — but if they'd rather you do it Automatically via the MCP, that's a
valid, fully model-grounded result; do it cleanly and note the one tradeoff (no stored
bundle). Don't keep pushing the dashboard after they've chosen.
