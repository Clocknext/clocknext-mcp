# Plan — what a customer subscribes to

A **plan** bundles the building blocks into what a customer actually buys and pays. It's a list
of **components** plus a billing cycle and currency. A purchase (subscription) raises a real
invoice, so plans are the last thing you build before the real-money gates (Gate 1 = the
purchase, Gate 2 = the first real signal — [SKILL.md](../SKILL.md) rule 3, each asked alone).

## Components
Each component is one of five types, in one of two billing modes.

| Type | References | ADVANCE means | ARREAR means |
| --- | --- | --- | --- |
| **WALLET** | — | Prepaid `amount` (USD) topped up up-front. | (Rarely used; a metered wallet. Not allowed with `walletFundedArrear`.) |
| **FLAT** | — | A one-off `amount` (USD) fee. | Same one-off fee. |
| **CREDIT** | `creditId` | Grant a `quantity` of [credits](credit.md) up-front. | Meter actual credit usage. |
| **OUTCOME** | `outcomeId` | Grant a `quantity` of [outcomes](outcome.md) up-front. | Bill each completed outcome. |
| **UNIT** | `unitId` | Prepay a `quantity` of [units](unit.md) (priced through tiers). | Meter actual unit events. |

- **ADVANCE** = billed **up-front for the cycle**; needs `amount` (WALLET/FLAT) or `quantity`
  (CREDIT/OUTCOME/UNIT).
- **ARREAR** = **metered**, billed for what was consumed (at cycle end, or from the wallet if
  [`walletFundedArrear`](wallet.md) is on).
- CREDIT/OUTCOME/UNIT components reference an **existing** catalogue entitlement by id — **create
  those first**. WALLET and FLAT exist only here, not in the catalogue.
- At most **one WALLET** and **one FLAT** component per plan; each credit/outcome/unit at most once.

## Create it — `clocknext_create_plan`

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Plan name. |
| `billingCycle` | yes | `MONTHLY` \| `QUARTERLY` \| `SEMI_ANNUAL` \| `YEARLY` \| `EVERY_5_MIN` \| `FREE`. `EVERY_5_MIN` is **testing-only** (cycles the whole invoice→payment→renewal loop in minutes, e.g. on sandbox) — never offer it for a real plan. |
| `components` | yes | ≥1 component (table above). |
| `currencyCode` | no | ISO 4217, default USD. |
| `isActive` | no | Sellable or not (default active). |
| `walletFundedArrear` | no | Pay metered usage from the prepaid wallet as it happens — see [`wallet.md`](wallet.md). Default false. |
| `priceAdjustment` | no | Signed rounding nudge (USD) on the due-at-purchase total; default 0 (coerced to 0 for FREE / all-ARREAR plans). |
| `carryForward` | no | **Deprecated** — accepted but ignored by the billing engine. |

**Update is a full rewrite** (`clocknext_update_plan`) — send the complete definition (read it
first with `clocknext_get_plan`); omitted fields are dropped, and `walletFundedArrear` reverts to
false unless re-sent. **Archive** (`clocknext_archive_plan`) is a reversible soft-deactivate.

## Due-at-purchase cost (verified) — only ADVANCE components count

    cost = Σ over ADVANCE components:
             WALLET  → amount
             FLAT    → amount
             CREDIT  → quantity × pricePerCredit
             OUTCOME → quantity × pricePerOutcome
             UNIT    → priceUnits(quantity, pricingType, flatPrice, tiers)   // see unit.md
         + priceAdjustment
    ARREAR components add 0 up-front (they're billed on consumption).
    FREE or all-ARREAR plans → cost coerced to 0 (priceAdjustment ignored).

### Worked example
Components: WALLET ADVANCE **$1,000**; CREDIT ADVANCE **100 @ $0.65**; OUTCOME ADVANCE
**50 @ $0.375**; UNIT ADVANCE **10,000** at SLAB tiers [1–1,000 @ $0.01],[1,001+ @ $0.005];
FLAT **$50**; plus a CREDIT **ARREAR** (metered).

    WALLET  = 1000
    CREDIT  = 100 × 0.65   = 65
    OUTCOME = 50 × 0.375   = 18.75
    UNIT    = 1,000·0.01 + 9,000·0.005 = 10 + 45 = 55        (SLAB — see unit.md)
    FLAT    = 50
    ARREAR credit → 0 up-front
    cost = 1000 + 65 + 18.75 + 55 + 50 = $1,188.75           ← charged at purchase

The ARREAR credit is then billed as consumed — separately at cycle end, or from the wallet if
`walletFundedArrear` is on.

## Rules & gotchas
- **FREE plans** must be **ADVANCE-only with no FLAT** component (they only grant; they raise no
  invoice).
- Cross-component rules (the wallet-funded three, one-wallet/one-flat, FREE constraints) are
  enforced by the backend with a **clean 422** — the tool surfaces the message; fix and resend.
- Changes apply **going forward**; customers already on a plan keep their terms.
- Prefer the dashboard plan builder for anything non-trivial (live preview) — the MCP is the
  fallback. See [`ui-links.md`](ui-links.md) and `SKILL.md` step 3.

## See also
[`credit.md`](credit.md) · [`outcome.md`](outcome.md) · [`unit.md`](unit.md) ·
[`wallet.md`](wallet.md) · [`entitlements.md`](entitlements.md) ·
[`pricing-and-models.md`](pricing-and-models.md)
