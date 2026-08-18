# Proving it works

Always dry-run before real traffic, then read the state back. Do all of this on **sandbox**
(`clocknext_whoami` confirms sandbox vs live) before promoting to live.

1. **Dry run** — `clocknext_verify_signal` with the *exact* signal your code will send. Why
   first: it prices **without recording**, so it confirms the customer, model, plan and
   `agentKey` all line up with **zero risk** of a bad bill. Fix any mismatch here before
   sending anything real.
2. **One real signal** — run the product path (or `clocknext_record_usage`) so a real signal
   fires for the dummy customer. Why: only real traffic proves the wiring end-to-end.
3. **Read it back** (why: a signal that "sent" isn't proof — you confirm it *landed and moved
   the balance*):
   - `clocknext_get_customer_usage` → the log landed with the expected model, tokens, cost.
   - `clocknext_get_customer_balances` → credits / outcomes / **units** drew down as expected.
     (This is also how you confirm **unit** consumption — the MCP has no unit-event read tool;
     the unit's balance here is the signal it worked.)
4. If anything is off, fix it and re-run the dry run first.

**Done** = a real signal shows up with the right cost **and** the customer's balance moved.
Only then offer to promote to live / wire real customer onboarding.
