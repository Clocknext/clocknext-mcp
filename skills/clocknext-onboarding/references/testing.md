# Proving it works

Always dry-run before real traffic, then read the state back. Prefer **sandbox**
(`clocknext_whoami` confirms sandbox vs live) — but if the user chose live in S2,
run the same sequence there without re-litigating the org choice (SKILL.md S2); the
two money gates are the guardrails.

1. **Confirm the wiring** — `clocknext_get_customer_plan` shows the customer's active plan;
   check it's the one you expect **before** firing anything. This corresponds to S27 in
   `SKILL.md`, not a separate permission to send a real signal.
2. **Dry run** — `clocknext_verify_signal` with the *exact* signal your code will send. Why
   first: it prices **without recording**, so it confirms the customer, model, plan and
   `agentKey` all line up with **zero risk** of a bad bill. Fix any mismatch here before
   sending anything real.
3. **One real signal** — ⛔ **money gate 2: ask first, alone, and wait** (the purchase
   approval did NOT authorize this — a real signal draws down a real balance). Only after
   that yes, run **the product's own code path** so a real signal fires for the dummy
   customer. There is no MCP tool that records usage — the MCP prices signals and never
   bills — so the product's SDK call is the only way, and it is also the point: only real
   traffic through your own code proves the wiring end-to-end.
4. **Read it back** (why: a signal that "sent" isn't proof — ingest is **asynchronous**, so
   a signal your code accepted can still be rejected downstream, e.g. an `agentKey` that
   matches nothing. You confirm it *landed and produced the expected usage record*):
   - `clocknext_get_customer_usage` → the log landed with the expected model, tokens, cost.
   - `clocknext_get_customer_balances` → credits/outcomes drew down as expected.
   - For **Units**, read Unit usage/event counts through the product SDK/API's supported Unit
     usage endpoint. The MCP does not expose a Unit-event read tool, and an ARREAR Unit may
     have no balance to decrement, so never use balance alone as proof of a Unit event.
4. If anything is off, fix it and re-run the dry run first.

**Done** = a real signal shows up with the right cost; credit/outcome balances move where
applicable, and Unit usage counts/events show the expected event.
Only then offer to promote to live / wire real customer onboarding.
