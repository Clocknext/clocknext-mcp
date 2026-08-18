# Dashboard deep-links (the "Manually" path)

These are the links you hand the user when they choose to do a step **Manually** instead of
**Automatically via MCP**. Base URL: **https://payments.clocknext.com** (the MCP's
`CLOCKNEXT_BASE_URL`; the dashboard is the same app). When you give a link, also **say what to
enter** — a bare link isn't guidance. Always render as a real markdown link, e.g.
"[set the price here](https://payments.clocknext.com/settings/models)".

| To do this Manually | Link | What the Automatic-via-MCP equivalent is |
| --- | --- | --- |
| Enable / price models | `{base}/settings/models` | `clocknext_add_model` |
| Create / price a credit | `{base}/credits` | `clocknext_create_credit` |
| Create / price an outcome | `{base}/outcomes` | `clocknext_create_outcome` |
| Create / price a unit | `{base}/units` | `clocknext_create_unit` |
| Create a plan | `{base}/plans` | `clocknext_create_plan` |
| Manage customers | `{base}/customers` | `clocknext_create_customer` |

For **credits and outcomes**, the Manual (dashboard) path is the richer one and worth
recommending: it shows a **live price preview** and **stores the full per-model pricing
bundle** on the entitlement, which the MCP path can't (the MCP stores only the final computed
price). Tell the user that reason when you recommend it — see `pricing-and-models.md`.

(Creation lives on these top-level management pages — e.g. the "New credit" form is on
`/credits`, the plan builder on `/plans`.) If `CLOCKNEXT_BASE_URL` is set to a non-production
workspace, substitute that host instead of `payments.clocknext.com`.

Note there is **no dashboard equivalent for recording or confirming unit *events*** — those
happen in the customer's product at runtime, and the MCP has no unit-usage tool. Confirm unit
consumption via a customer's **unit balance** (`clocknext_get_customer_balances`).
