---
name: clocknext-customer-mapping
description: Link a product's own users or tenants to ClockNext customers — add a clocknextCustomerId column to the auth/user model, create a ClockNext customer on signup, and backfill existing users — so every usage signal can be attributed to a customer. Use after onboarding, when wiring ClockNext into an existing authentication/user system, or when the user asks to "map customers", "connect our users to ClockNext", or "import existing customers".
---

# Map your users to ClockNext customers

Every ClockNext usage signal carries a `customerId`. This skill links your product's
users (or tenants/orgs — map at whatever level you *bill*) to ClockNext customers so
signals can be attributed and billed.

## 1. Add the mapping column

- Add a **nullable** `clocknextCustomerId` (string) to your user/tenant model
  (Prisma / Drizzle / SQL / whatever). Nullable so existing rows and new signups can
  backfill it over time.
- If you bill **per organisation/tenant**, put it on the org/tenant table, not the user.
  One ClockNext customer per *billable* entity.

## 2. Create a ClockNext customer on signup

In your signup / tenant-creation path, right after the local record is created:
- **JS/TS:** `cnk.customers.create({ name, email })` → store the returned `.id` on
  `clocknextCustomerId`.
- **Non-JS:** `POST /api/v1/customers` — `clocknext_search_docs kind=api` + `get_doc` for
  the exact fields.
- Use the **same `email`** you store locally — it's the key the bulk backfill matches on.
- Make it **idempotent:** if `clocknextCustomerId` is already set, skip.

## 3. Use it when metering

- When sending a usage signal, load the user's `clocknextCustomerId` and pass it as the
  signal's `customerId`.
- If it's null (an older user created before this wiring), create-and-backfill on the fly
  (step 2), then send the signal.

## 4. Backfill existing users (bulk)

Use the **`clocknext_bulk_import_customers`** MCP tool:
- Pass an array of `{ name, email }` (plus any optional profile), **≤200 per call**.
- It creates them sequentially and returns a **per-row** result — `{ email, id }` on
  success or `{ email, error }` on failure — so one duplicate/bad row never aborts the
  batch.
- Write each returned `id` back onto the matching user **by email**. Chunk a large base
  into ≤200-row calls.

## Guardrails

- **Dedupe by email before creating** — one ClockNext customer per billable entity;
  re-running signup logic must not create duplicates.
- **Store the id; don't look customers up by email at runtime** — it's slower and emails
  change.
- Do the first backfill against **sandbox** (`clocknext_whoami` → `sandbox`) and spot-check
  the email→id map before running it against `live`.
