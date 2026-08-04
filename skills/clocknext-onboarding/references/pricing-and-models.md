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

## How a base price is built (credits + outcome steps)
`basePrice` = the provider cost of a **model bundle**. For each chosen model: a token volume
split by an **input / output / cache percentage mix** (the three total 100), priced at that
model's per-1M-token rates, summed across models. Then:

    pricePerCredit  = basePrice × (1 + margin% / 100)
    pricePerOutcome = (Σ step basePrices) × (1 + margin% / 100)

The **server grounds this**: on create/update it recomputes the base price from the bundle's
**live** model prices and **rejects any turned-off or unknown model**. So an entitlement can
never be priced off a disabled model, and a hand-typed base price is ignored in favour of the
computed one. If a save is refused with "…is turned off," re-enable the model on the Models
page or drop it from the bundle.

## Why prefer the UI for pricing
The model bundle is keyed by the internal **`OrgModel.id`**, which the public API and
`clocknext_list_models` do **not** expose — so building a valid bundle over MCP means
resolving that id yourself. The dashboard calculator handles it and shows a live price
preview. **Lead with the UI link** (`{base}/credits`, `{base}/outcomes`, `{base}/units`);
only build via MCP if the user insists, and fall back to the UI the moment it gets fiddly.
