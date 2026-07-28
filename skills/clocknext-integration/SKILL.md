---
name: clocknext-integration
description: Integrate the ClockNext SDK (@clocknext/sdk) into a codebase to meter usage and bill for API/LLM calls. Use when the user asks to add ClockNext, meter usage, credit/charge per API call, wire up usage-based billing, or send usage signals. Pair with the clocknext MCP tools (whoami / list_models / verify_signal / record_usage).
---

# Integrating ClockNext usage-based billing

Meter a product's API/LLM calls with ClockNext: after each billable call you send
a **signal** priced against the model's tokens and the customer's plan. Use the
`@clocknext/sdk` (server-side only) for the code, and the **clocknext MCP tools**
to ground yourself and to send test signals.

## 0. Ground yourself first (MCP tools — do this before writing code)

- **`clocknext_whoami`** → confirm which org the key points at and whether it's
  `sandbox` or `live`. Integrate against **sandbox** until it's proven.
- **`clocknext_list_models`** → the valid `modelId` values and their prices. The
  `model` you send in a signal MUST be one of these ids (matched case-insensitively).

## 1. Install + configure

```bash
npm i @clocknext/sdk
```

The API key is a **secret** — server-side only, from env, never in client code:

```ts
import { ClockNext } from "@clocknext/sdk";
const cnk = new ClockNext({ apiKey: process.env.CLOCKNEXT_API_KEY! });
// Optional: baseUrl: process.env.CLOCKNEXT_BASE_URL for staging.
```

Instantiate **once** and reuse it (module singleton), not per request.

## 2. Meter every billable call

Find where the product makes the billable call (usually an LLM/API call in a
route handler or service) and, right after it returns, record a signal. Pick the
meter type the customer's plan uses:

```ts
// "credit" — draw down a named credit (needs the credit's stable agentKey):
await cnk.signals.credit({
  customerId,                         // the ClockNext customer for this end-user
  model: "gpt-4o",                    // a modelId from clocknext_list_models
  agentKey: "pro_credit",             // the Credit's agent key
  tokens: { input: usage.prompt_tokens, output: usage.completion_tokens },
  idempotencyKey: requestId,          // reuse across retries of THIS call
});

// "wallet" — debit the customer's USD wallet at model cost (no agentKey):
await cnk.signals.wallet({
  customerId,
  model: "gpt-4o",
  tokens: { input, output },          // input + output are REQUIRED; cache optional
  idempotencyKey: requestId,
});
```

Key rules:
- `tokens.input` and `tokens.output` are **required**; `tokens.cache` is optional.
- Get token counts from the provider's response `usage` (e.g. OpenAI
  `prompt_tokens` / `completion_tokens`; Anthropic `input_tokens` / `output_tokens`).
- Pass an **`idempotencyKey`** (a stable id for the call) so a retry after a lost
  response can't double-bill.
- `customerId` is the ClockNext customer id for the end-user; map it from the
  product's own user/tenant id. If the product has no ClockNext customer yet,
  that must be created first (out of scope here — ask the user how customers map).

## 3. Don't lose signals on serverless / before exit

Signals buffer and flush in the background. Before a serverless function returns
or the process exits, drain the buffer:

```ts
await cnk.flush();        // e.g. at the end of a Lambda/Vercel handler
// or on graceful shutdown: await cnk.close();
```

Or pass `{ wait: true }` on a single call to send it synchronously and get the
priced `usageLog` back.

## 4. Verify, then send a dummy signal

**Before real traffic**, dry-run to confirm the customer + model + plan price
correctly — this records NOTHING:

- MCP: **`clocknext_verify_signal`** with the same fields, or
- SDK: `const projected = await cnk.signals.verify({ type: "wallet", customerId, model, tokens: { input: 1000, output: 500 } });`

Then send a **dummy real signal** to prove the end-to-end path:

- MCP: **`clocknext_record_usage`** (fastest — no code run needed), or
- SDK: `await cnk.signals.credit({ ...fields, tokens: { input: 1000, output: 500 } }, { wait: true });`

A signal needs a customer whose active plan has a matching **wallet / credit /
outcome** component; against a UNIT-only or plan-less customer you'll get a clean
`PlanError` (422) — that means the wiring works but the plan doesn't grant that meter.

## Recap of the flow for "integrate + credit every call + dummy signal"
1. `clocknext_whoami` + `clocknext_list_models` (ground: env + valid ids).
2. `npm i @clocknext/sdk`; instantiate from `CLOCKNEXT_API_KEY`.
3. After each billable call, add `cnk.signals.credit(...)` (or `.wallet`) with the
   real token counts + an `idempotencyKey`; add `flush()` before serverless return.
4. `clocknext_verify_signal` to confirm pricing, then `clocknext_record_usage`
   (or a real `cnk.signals.*` call) to fire the dummy signal.
