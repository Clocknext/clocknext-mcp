# Metering the codebase

## SDK vs API (decide first, by inspecting the codebase)
- **JS / TS codebase → `@clocknext/sdk`** — typed, with buffering, retries, and idempotency
  built in.
- **Any other language → the REST API** — `POST /api/v1/usage` for credit / outcome / wallet
  signals, `POST /api/v1/units` for unit events.
Ground the exact call shapes in the docs first (`clocknext_search_docs kind=javascript` for
JS/TS, `kind=api` otherwise).

## The metering recipe — WRITE THIS, don't hand-roll a wrapper

There is ONE correct integration shape. It's the same for credit, outcome, unit, and wallet.
Produce this — do NOT invent a `mode:"sync"` + `try/catch` wrapper (that reinvents what the
SDK already does and blocks every request).

### 1. One singleton client — **async mode + `onError`**
Async is the default: fire-and-forget, non-blocking, retried, and it routes failures to
`onError` — **never to the caller**. So there is nothing to `try/catch`, and no blocking hop.

```ts
// clocknext.ts
import { ClockNext } from "@clocknext/sdk";
let client: ClockNext | undefined;
export const meteringEnabled = Boolean(process.env.CLOCKNEXT_API_KEY);
export function clocknext(): ClockNext | undefined {
  if (!meteringEnabled) return undefined;
  client ??= new ClockNext({
    apiKey: process.env.CLOCKNEXT_API_KEY!,
    onError: (err, signal) => logger.warn({ err, type: signal?.type }, "clocknext metering failed"),
  });
  return client;
}
export const shutdownMetering = () => client?.close().catch(() => {}); // call on SIGTERM
```

### 2. Thin, domain-named helpers — one per meter, agentKeys as constants
No `await`-blocking, no `try/catch`. Address each meter by the **exact agentKey** (see the
agentKey rule below). One line each:

```ts
const KEYS = { chat: "pro_credit", review: "review.analyse", seat: "seats" } as const;

export const meterChat  = (customerId, model, t) => clocknext()?.signals.credit({ customerId, model, agentKey: KEYS.chat, tokens: t });
export const meterStep  = (customerId, model, t) => clocknext()?.signals.outcome({ customerId, model, agentKey: KEYS.review, tokens: t }); // outcome = the STEP key
export const meterWallet= (customerId, model, t) => clocknext()?.signals.wallet({ customerId, model, tokens: t });                        // USD at cost, no margin
export const meterSeat  = (customerId)           => clocknext()?.signals.unit({ customerId, agentKey: KEYS.seat });                       // one event, no tokens
```

Call them on the **server**, at the billable boundary, **after** the work succeeds.

### 3. When (and only when) to deviate
- **Gate a request on balance** (reject when out of allowance) → that call uses `{ wait: true }`
  and reads `res.usageLog`, or catches the typed `AllowanceError`. This is the ONLY reason to
  block on a send.
- **Preflight** before real traffic → `cnk.signals.verify(signal)` (dry run, records nothing).
- **At-least-once** (queues/your own retries) → pass your own stable `idempotencyKey`.

## Getting the key into `.env` (the key never enters your context)
The recipe above reads `process.env.CLOCKNEXT_API_KEY` at runtime — you never need the
literal key to write the code. To get it into the project, offer the usual choice:
- **Manually** — the user copies the same `cnk_…` key they configured for this MCP server
  into the project's `.env`.
- **Automatically via MCP** — `clocknext_write_env { envFilePath }`: the server copies the
  key from its own environment into the file server-side and returns only `ok` — the key
  never appears in the conversation. It only accepts files named `.env`, `.env.local`, or
  `.env.development[.local]`, and refuses when the file is git-tracked or not gitignored
  (fix `.gitignore`, then retry).

Either way: add a `CLOCKNEXT_API_KEY=` **placeholder** to `.env.example` (never a real key),
confirm `.env` is gitignored (rule 10), and never ask the user to paste the key into the chat.

## The agentKey rule (human-in-the-loop — do NOT get this wrong)
Every credit/outcome signal carries an `agentKey` that must **exactly match** a created
entitlement. The mapping is the user's decision, never yours:
1. Pull the real keys: `clocknext_list_credits`, `clocknext_list_outcomes` (each **step** has
   its own key), `clocknext_list_units`.
2. For **every** call site you're about to meter, show the candidate entitlements **by name**
   and **ask, in plain words, which one this call should charge against** (rule 12) — the
   `agentKey` is what you wire internally, not what you ask the user for.
3. **Never invent, guess, or reuse a key without an explicit pick.** A wrong key silently
   meters against the wrong entitlement and corrupts billing.

## Units are not LLM calls
Meter units where the *event* happens in the customer's product — `signals.unit({ agentKey })`
(SDK) or `POST /api/v1/units` (REST). One call = one unit: no tokens, no model. This is the
product's runtime job, **not** the MCP's — the MCP only builds the catalogue.

## Safety
- Keep the `cnk_` key **server-side** (env / secret store) — never client-side, never committed.
- Meter on the **billable boundary** (the real model/API call), not on UI events.
- Send signals from the **server**, after the work succeeds.
- Wire `shutdownMetering()` into graceful shutdown so buffered signals aren't lost on deploy.
