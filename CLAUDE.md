# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sibling repos (one directory up, in `../`)

- `../Clocknext-Payment-Saas` → the main payments app (the `/api/v1` server this talks to).
- `../clocknext-sdk-cleanup` → the TypeScript SDK.
- `../clocknext-docs` → the docs.

## What this repo is

`@clocknext/mcp` — a **stdio MCP server** that exposes ClockNext usage-based billing to AI coding tools. The repo ships two coupled artifacts:

- **The MCP server** (`src/`) — the tools an agent calls (whoami, list/add models, verify/record usage, catalogue CRUD, customers, docs search).
- **The `clocknext-onboarding` skill** (`skills/clocknext-onboarding/`) — the human-in-the-loop playbook that *drives* those tools to onboard a product end-to-end. The skill is the "policy"; the server tools are the "mechanism." Changing tool names, args, or semantics means checking whether `SKILL.md` and its `references/*.md` still describe them correctly.

## Commands

```bash
npm install          # pulls the published @clocknext/sdk
npm run build        # tsup → dist/index.js (single self-contained executable bin)
npm run dev          # run from source via tsx (needs CLOCKNEXT_API_KEY in env)
npm run typecheck    # tsc --noEmit (strict); CI runs this before build
CLOCKNEXT_API_KEY=cnk_... npm start   # run the built server
```

There is **no test suite and no linter** — `npm run typecheck` is the only static gate. To exercise the server manually, run it with a real `cnk_…` key against a **sandbox** org (see `clocknext_whoami`).

## Critical build/commit rule

`dist/` **is committed to git** and is what the Claude Code plugin runs directly (the plugin cache never runs `npm install`). tsup bundles *all* dependencies into one file (`noExternal: [/.*/]` in `tsup.config.ts`), so `node dist/index.js` runs with no `node_modules`. **After any change under `src/`, run `npm run build` and commit the regenerated `dist/` in the same change** — otherwise the plugin ships stale code.

## Architecture

- **Entry:** `src/index.ts` — builds one `ClockNext` client from env (`makeClient()`), constructs the `McpServer`, and calls each `register*` function to attach tools. `main()` connects over `StdioServerTransport`.
- **stdout is the JSON-RPC channel — never write to it.** All logging goes to **stderr** (`console.error`). A stray `console.log` corrupts the protocol.
- **The `cnk_…` API key never enters the model's context.** It's read from `process.env.CLOCKNEXT_API_KEY` inside the server and passed to the SDK / raw fetches; tools receive only non-secret args.
- **Every tool lives in its own `src/tools/*.ts`** and exports a `registerXxx(server, cnk)` function. To add a tool: create the file, export a register fn, and call it from `index.ts`.
- **Two API paths:**
  - **Typed SDK (`@clocknext/sdk`)** — the default for everything (`cnk.signals`, `cnk.plans`, `cnk.customers`, `cnk.workspace.models`, …).
  - **Raw `fetch` with the `cnk_` bearer** — only for MCP-internal endpoints deliberately kept off the public SDK: `clocknext_add_model` (`POST /api/v1/models`) and `clocknext_bulk_import_customers` (`POST /api/v1/customers/bulk`). Base URL mirrors the SDK via `CLOCKNEXT_BASE_URL` (default `https://payments.clocknext.com`).
  - Public docs tools (`search_docs`, `get_doc`) use `fetchJson` (`src/tools/http.ts`) against the docs origin — **no API key** (`CLOCKNEXT_DOCS_URL`, default `https://help.clocknext.com`, resolved defensively in `docs-url.ts`).

### Shared conventions (follow these when adding/editing tools)

- **Result helpers in `src/tools/util.ts`:** return `jsonResult(data)` for success and `errorResult(msg)` for failures — **catch SDK/network errors and turn them into `errorResult(errMsg(err))`; do not let a tool throw.** `errMsg` special-cases `ClockNextError` to include the HTTP status.
- **Inputs are Zod `ZodRawShape`s** (flat objects, as MCP requires). Push validation into the schema (`.refine`, `.enum`, `.min`) where possible. Cross-field rules that can't be expressed flatly are enforced in the handler and returned as an `errorResult` (e.g. `buildSignal` requiring `agentKey` for credit/outcome).
- **Descriptions are load-bearing.** Tool and field `describe()` text is the agent's only guidance — it encodes rules (idempotency, "records for real vs dry run", "full rewrite not a patch", "prefer the dashboard"). Keep them precise and current when behavior changes.
- **Annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are set intentionally per tool — mirror the neighbours when adding one.
- **Usage signals** share `signalShape` + `buildSignal` (`src/tools/signal.ts`) between `verify_signal` (dry run, prices nothing) and `record_usage` (bills for real). Keep them in lockstep.

### Domain model (needed to touch catalogue/pricing code)

- Catalogue resources: **plans** bundle **components**, each of type `WALLET | FLAT | CREDIT | OUTCOME | UNIT`. `src/tools/catalogue.ts` generates list/get/create/update/archive for credits, outcomes, units, and plans via one `registerCrud` factory.
- **Archive = soft deactivate** (`setActive(id, false)`), never a hard delete. **Update = full rewrite**, not a patch — omitted fields are dropped/cleared.
- **Pricing is model-grounded, never hand-typed.** Credit/outcome create/update take a **model mixer** (`models`: enabled catalog model + avg tokens + input/output/cache split summing to 100, + `marginPercent`). `computeMixerBase()` reads the org's live per-1M-token prices via `cnk.workspace.models` and computes the base price server-side; a caller can't inject an ungrounded price. Wallet components debit at **raw model cost (no margin)**; units are fixed-price per event (no tokens).

## SDK authoring conventions (`@clocknext/sdk` style)

This repo *consumes* `@clocknext/sdk`, but usage-billing work often spans both. When you write or extend the SDK (its own repo), or model SDK-shaped types here, follow the conventions the installed SDK already demonstrates (`node_modules/@clocknext/sdk/dist/index.d.ts` is the best reference — read it). Several are already mirrored in this server's tools.

**Types are the API — make illegal states unrepresentable.**
- **Discriminated unions for mutually-exclusive shapes**, keyed on a literal `type` field. `Signal = CreditSignal | WalletSignal | OutcomeSignal` mirrors the server's Zod `recordSchema`, so per-variant required fields (`agentKey` on credit/outcome, not wallet) are enforced at **compile time instead of surfacing as runtime 422s**. When the server validates with a discriminated schema, mirror it as a discriminated union — don't collapse it into one interface with optional fields.
- **Derive input types from entity types**, don't hand-duplicate: `type CreditInput = Omit<CreditSignal, "type">`; `type CreateCustomerInput = CustomerProfileInput & { name: string; email: string }`. Keep `Create*Input` (required fields), `Update*Input` (all optional / patch), and the read entity as distinct types.
- **`null` vs `undefined` is semantic and must be documented.** Convention here: on write inputs `null` **clears** a column, omitting (`undefined`) **leaves it unchanged**; on read models a truly-absent value is explicit `T | null`. Don't use `?:` and `| null` interchangeably.
- **No `any`.** Use `unknown` for genuinely open values (`custom?: Record<string, unknown>`, `onError(error: unknown)`) and let callers narrow. `strict` is on.
- **JSDoc every exported type and field** with what it means, its **units** (e.g. "USD per 1,000,000 tokens"), its default, and *when* it's populated vs `null` (e.g. "balance is null on dry runs and read-back"). These docs are the primary reference surface — treat them as load-bearing, like the MCP tool descriptions.
- Name wire/response DTOs with a `Serialized*` prefix; export **types** type-only (`export type Foo`) and classes as value exports.

**Client architecture — one seam, composed resources.**
- A single root `ClockNext` class holds `readonly` resource sub-clients (`signals`, `customers`, `plans`, `workspace`, …), each its own class taking a shared `Transport`.
- **All HTTP goes through one `Transport` seam**: it builds the authenticated request, enforces the timeout, unwraps the `{ ok, ... }` envelope, maps status → typed error, and retries transient failures with backoff + jitter. Resource classes never call `fetch` directly.
- **Config object with documented defaults**, plus an internal `ResolvedConfig` (= config with every default applied) so downstream code sees non-optional fields.
- **Injectable seams for testability**: `fetch?: FetchLike` and `logger?: Logger` are config options defaulting to globals.
- **Idempotency/retry safety is method-based**: reads (GET), idempotent replaces (PUT) and DELETE are replay-safe and retried; non-idempotent writes (POST/PATCH) are **not** auto-retried so a transient failure can't duplicate a write (callers opt in). This is the same reasoning behind the MCP tools' `idempotentHint` annotations.
- Consistent CRUD verbs across every resource: `list(params?)`, `get(id)`, `create(input)`, `update(id, input)`, `setActive(id, bool)`. Add lifecycle methods (`flush()`, `close()`, `pending`) where buffering exists.

**Errors — a typed hierarchy callers branch on.**
- `ClockNextError extends Error` carries `status?: number` and `retryable: boolean`; subclasses map one-to-one to HTTP status (`AuthError` 401, `ValidationError` 400, `NotFoundError` 404, `PlanError`/`AllowanceError` 422, `ConflictError` 409, `RateLimitError` 429 with `retryAfterMs`, `ServerError` 5xx, `NetworkError` for a request that never completed). Callers branch on the **kind**, never string-match messages. This server's `errMsg` (`src/tools/util.ts`) already special-cases `ClockNextError` to surface `status`.

**Packaging — dual ESM/CJS, tree-shakeable, validated.**
- `"type": "module"`, `"sideEffects": false`, and an `exports` map with distinct `import`/`require` conditions each pointing at their own types (`index.d.ts` / `index.d.cts`); `main`→CJS, `module`→ESM, `types`→DTS. Ship only `["dist", "README.md"]`, `engines: node >=18`.
- Build with tsup; gate publishes with `publint --strict && attw --pack` (are-the-types-wrong) in `prepublishOnly` so broken exports/types can't ship. Tests run on vitest, `tsc --noEmit` as the type gate.

## Releasing

Tag push (`v*`) triggers `.github/workflows/publish-mcp.yml`, which typechecks, builds, `npm publish`es with provenance, then publishes `server.json` to the MCP Registry via GitHub OIDC. The tag **must** match `package.json` `version` or CI fails. Before tagging, bump the version in **all four** places: `package.json`, `server.json` (both `version` fields), `src/index.ts` (the `McpServer` version), and `.claude-plugin/plugin.json` — then `npm run build` and commit `dist/`.
