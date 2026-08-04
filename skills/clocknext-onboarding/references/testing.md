# Proving it works

Always dry-run before real traffic, then read the state back. Do all of this on **sandbox**
(`clocknext_whoami` confirms sandbox vs live) before promoting to live.

1. **Dry run** — `clocknext_verify_signal` with the *exact* signal your code will send. It
   prices without recording, and confirms the customer, model, plan and `agentKey` all line
   up. Fix any mismatch here before sending anything real.
2. **One real signal** — run the product path (or `clocknext_record_usage`) so a real signal
   fires for the dummy customer.
3. **Read it back:**
   - `clocknext_get_customer_usage` → the log landed with the expected model, tokens, cost.
   - `clocknext_get_customer_balances` → credits / outcomes / units drew down as expected.
   - `clocknext_get_customer_unit_usage` → unit events, if any.
4. If anything is off, fix it and re-run the dry run first.

**Done** = a real signal shows up with the right cost **and** the customer's balance moved.
Only then offer to promote to live / wire real customer onboarding.
