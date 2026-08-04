# Dashboard deep-links

Base URL: **https://payments.clocknext.com** (the MCP's `CLOCKNEXT_BASE_URL`; the dashboard
is the same app). Prefer these for catalogue / plan setup — they're clearer and show a live
price preview. Always render as a real markdown link, e.g.
"[set the price here](https://payments.clocknext.com/settings/models)".

| Do this | Link |
| --- | --- |
| Enable / price models | `{base}/settings/models` |
| Create / price a credit | `{base}/credits` |
| Create / price an outcome | `{base}/outcomes` |
| Create / price a unit | `{base}/units` |
| Create a plan | `{base}/plans` |
| Manage customers | `{base}/customers` |

(Creation lives on these top-level management pages — e.g. the "New credit" form is on
`/credits`, the plan builder on `/plans`.) If `CLOCKNEXT_BASE_URL` is set to a non-production
workspace, substitute that host instead of `payments.clocknext.com`.
