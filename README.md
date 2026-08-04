# @clocknext/mcp

The **ClockNext MCP server** — meter usage, verify signals, and manage
usage‑based billing directly from AI coding tools (Claude Code, Cursor, Codex,
Antigravity, …) and any other [Model Context Protocol](https://modelcontextprotocol.io)
client.

It runs **locally over stdio**: your AI tool spawns it as a subprocess, and your
organisation's `cnk_…` API key stays in the server's environment — never in the
model's context.

This repo ships **two** things:

- **the MCP server** (`@clocknext/mcp`) — the tools an agent calls.
- **the `clocknext-onboarding` skill** — the step‑by‑step playbook that drives a
  full setup using those tools (human‑in‑the‑loop, sandbox‑first).

You can install them together (the Claude Code plugin) or separately. Pick one:

| You want… | Install |
| --- | --- |
| Everything, in **Claude Code**, one command | **[A. The plugin](#a--claude-code-plugin-recommended)** — MCP tools **+** skill, prompts for your key |
| Just the **tools**, in any MCP client | **[B. The MCP server alone](#b--the-mcp-server-alone-any-harness)** |
| Just the **skill** (the guided flow) | **[C. The skill alone](#c--the-skill-alone-any-harness)** |

> A ClockNext API key is required for the tools: **Settings → API Keys** →
> `cnk_…`. It is a server‑side secret — keep it in env/secret config, never in
> client code or a repo.

---

## A — Claude Code plugin (recommended)

Installs the MCP server **and** the `clocknext-onboarding` skill in one step, and
wires the API key for you.

```
/plugin marketplace add ClockNext/clocknext-mcp
/plugin install clocknext@clocknext
```

Claude Code prompts for your ClockNext API key at install (stored securely), runs
the bundled server, and auto‑discovers the skill from the plugin's `skills/`
folder. Verify:

- `/mcp` → the `clocknext` tools are listed.
- The skill triggers automatically when you start any ClockNext work (or check
  your installed skills).

No manual config, no env vars, nothing to build.

---

## B — The MCP server alone (any harness)

Gives you the **tools only** (no skill). Works in any MCP client via
`npx -y @clocknext/mcp`. You supply `CLOCKNEXT_API_KEY`.

**Claude Code** (CLI):

```bash
claude mcp add clocknext --env CLOCKNEXT_API_KEY=cnk_your_key -- npx -y @clocknext/mcp
```

**Cursor** — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "clocknext": {
      "command": "npx",
      "args": ["-y", "@clocknext/mcp"],
      "env": { "CLOCKNEXT_API_KEY": "cnk_your_key" }
    }
  }
}
```

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`: same `mcpServers` block as
Cursor above.

**Antigravity** — its MCP settings JSON: same `mcpServers` block as Cursor.

**VS Code** (native MCP / Copilot) — `.vscode/mcp.json`:

```json
{
  "servers": {
    "clocknext": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@clocknext/mcp"],
      "env": { "CLOCKNEXT_API_KEY": "cnk_your_key" }
    }
  }
}
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.clocknext]
command = "npx"
args = ["-y", "@clocknext/mcp"]
env = { CLOCKNEXT_API_KEY = "cnk_your_key" }
```

**Gemini CLI** — `~/.gemini/settings.json`: same `mcpServers` block as Cursor.

**Any other MCP client** — point it at this stdio command:

```
command: npx
args:    -y @clocknext/mcp
env:     CLOCKNEXT_API_KEY=cnk_your_key
```

### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `CLOCKNEXT_API_KEY` | yes | Your org's `cnk_…` key (Settings → API Keys). |
| `CLOCKNEXT_BASE_URL` | no | Override the API origin (e.g. a staging URL). Defaults to production. |
| `CLOCKNEXT_DOCS_URL` | no | Override the docs origin for the `search_docs`/`get_doc` tools. Defaults to `https://help.clocknext.com`. |

---

## C — The skill alone (any harness)

The **`clocknext-onboarding`** skill is the guided playbook (detect models →
entitlements → plan → meter the codebase → test with a dummy customer). It
**drives the MCP tools**, so install the MCP server too (**B** above) — the skill
on its own has nothing to call.

Get the skill folder (it's `skills/clocknext-onboarding/` — `SKILL.md` plus
`references/`):

```bash
git clone https://github.com/ClockNext/clocknext-mcp
# the skill lives at: clocknext-mcp/skills/clocknext-onboarding/
```

**Claude Code** (native skills — auto‑discovered, triggers by description):

```bash
# all projects:
mkdir -p ~/.claude/skills && cp -r clocknext-mcp/skills/clocknext-onboarding ~/.claude/skills/
# or this project only:
mkdir -p .claude/skills && cp -r clocknext-mcp/skills/clocknext-onboarding .claude/skills/
```

Then `/doctor` (or restart) — it appears in your skills and fires on ClockNext work.

**Cursor / Windsurf / Codex / Antigravity / others** — these don't auto‑load the
`SKILL.md` format, so add it as a rules/instructions file the tool already reads,
pointing at (or pasting) `skills/clocknext-onboarding/SKILL.md`:

| Harness | Put it in |
| --- | --- |
| Cursor | `.cursor/rules/clocknext-onboarding.md` |
| Windsurf | Windsurf Rules (workspace or global) |
| Codex / Antigravity | `AGENTS.md` |

The `references/*.md` files stay alongside `SKILL.md`; the flow pulls them in on
demand.

---

## Tools

| Tool | What it does |
| --- | --- |
| `clocknext_whoami` | Identify the org behind the key and whether it's **sandbox** or **live**. Call first. |
| `clocknext_list_models` | List enabled models + USD prices per 1M tokens. Use a `modelId` in signals. |
| `clocknext_add_model` | Enable a catalog model (autopriced); warns if it has no catalog price. |
| `clocknext_verify_signal` | **Dry run** — validate + price a signal without recording it. Preflight your setup. |
| `clocknext_record_usage` | Record one real (billed) usage signal. Supports an `idempotencyKey` for safe retries. |
| `clocknext_get_customer_usage` | Read back a customer's recent usage logs — confirm a signal landed. |
| `clocknext_get_customer_balances` | A customer's current wallet / credit / outcome / unit balances. |
| `clocknext_get_customer_plan` | A customer's current active plan (from their purchase). |

Plus catalogue CRUD (`create_plan` / `create_credit` / `create_outcome` /
`create_unit` …), customer tools (`create_customer`, `create_purchase`,
`bulk_import_customers`), and the docs tools (`search_docs`, `get_doc`). Run
`/mcp` to see the full list.

A typical agent flow: `whoami` → `list_models` → `verify_signal` (confirm the
customer/model/plan price correctly) → `record_usage` → `get_customer_usage`
(confirm it landed). The `clocknext-onboarding` skill orchestrates all of this.

## Development

```bash
npm install          # links the local @clocknext/sdk (file:../clocknext-sdk)
npm run build        # tsup → dist/index.js (executable bin)
npm run dev          # run from source via tsx
CLOCKNEXT_API_KEY=cnk_... npm start
```

Built on the official `@modelcontextprotocol/sdk` over `@clocknext/sdk`. stdio
today; a hosted Streamable‑HTTP variant is planned. Logs go to **stderr** (stdout
is the protocol channel). The committed `dist/` is what the plugin runs — rebuild
and commit it on any code change.
