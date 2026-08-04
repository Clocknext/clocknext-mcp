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

Install them together (the Claude Code plugin) or separately. Pick by what you
want and which agent you're on:

| Install | What you get | Works in |
| --- | --- | --- |
| **[Skill](#1--the-skill-every-ai-coding-agent)** — `npx skills add ClockNext/clocknext-mcp` | the guided onboarding flow | **every** agent (Claude Code, Cursor, Codex, Windsurf, Gemini, Antigravity, VS Code, …) |
| **[MCP server](#2--the-mcp-server-every-ai-coding-agent)** — `npx -y @clocknext/mcp` | the tools an agent calls | **every** MCP client |
| **[Plugin](#3--the-claude-code-plugin-claude-code-only)** — `/plugin install clocknext@clocknext` | MCP tools **+** skill, one step | **Claude Code only** |

The skill and the MCP server work together — the skill *drives* the tools — so for
the full guided experience install **both** (or just use the plugin, which bundles
them). The plugin is the one‑command option, but Claude Code only.

> A ClockNext API key is required for the tools: **Settings → API Keys** →
> `cnk_…`. It is a server‑side secret — keep it in env/secret config, never in
> client code or a repo.

---

## 1 — The skill (every AI coding agent)

The **`clocknext-onboarding`** skill is the guided playbook (detect models →
entitlements → plan → meter the codebase → test with a dummy customer). It
**drives the MCP tools**, so install the MCP server too (**§2 below**) — the skill
on its own has nothing to call.

Install it with **[`npx skills`](https://www.skills.sh)** — one command, works
across Claude Code, Cursor, Codex, Windsurf, Gemini, Antigravity, VS Code, and
~20 other agents:

```bash
# this project:
npx skills add ClockNext/clocknext-mcp
# or user-wide (all projects / all agents):
npx skills add ClockNext/clocknext-mcp --global
```

It reads the repo, finds `skills/clocknext-onboarding/` (`SKILL.md` + its
`references/`), and installs it into whatever agent(s) you have. `npx skills list`
shows what's installed; `npx skills remove clocknext-onboarding` removes it.

<details>
<summary>Manual install (no CLI)</summary>

Copy the folder from the repo into your agent's skills directory:

```bash
git clone https://github.com/ClockNext/clocknext-mcp
# Claude Code — all projects:
mkdir -p ~/.claude/skills && cp -r clocknext-mcp/skills/clocknext-onboarding ~/.claude/skills/
# …or this project only: .claude/skills/
```

For tools without a native skills folder (Cursor / Windsurf / Codex / Antigravity),
point their rules file at `skills/clocknext-onboarding/SKILL.md` — e.g.
`.cursor/rules/clocknext-onboarding.md`, Windsurf Rules, or `AGENTS.md`. Keep the
`references/*.md` files alongside `SKILL.md`.
</details>

---

## 2 — The MCP server (every AI coding agent)

Gives you the **tools** the skill (and you) call. Works in any MCP client via
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

> `@clocknext/mcp` is listed in the official [MCP Registry](https://modelcontextprotocol.io/registry/about)
> as `io.github.ClockNext/mcp`, so registry‑aware clients can discover it directly.

### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `CLOCKNEXT_API_KEY` | yes | Your org's `cnk_…` key (Settings → API Keys). |
| `CLOCKNEXT_BASE_URL` | no | Override the API origin (e.g. a staging URL). Defaults to production. |
| `CLOCKNEXT_DOCS_URL` | no | Override the docs origin for the `search_docs`/`get_doc` tools. Defaults to `https://help.clocknext.com`. |

---

## 3 — The Claude Code plugin (Claude Code only)

The one‑command option — installs the MCP server **and** the `clocknext-onboarding`
skill together, and wires the API key for you. **Claude Code only** (the plugin
format is Claude Code's; other agents use §1 + §2 above).

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
npm install          # pulls the published @clocknext/sdk
npm run build        # tsup → dist/index.js (executable bin)
npm run dev          # run from source via tsx
CLOCKNEXT_API_KEY=cnk_... npm start
```

Built on the official `@modelcontextprotocol/sdk` over `@clocknext/sdk` (bundled
into `dist/` by tsup). stdio today; a hosted Streamable‑HTTP variant is planned.
Logs go to **stderr** (stdout is the protocol channel). The committed `dist/` is
what the plugin runs — rebuild and commit it on any code change.

### Releasing (maintainers) — automated

A tag push publishes **both** the npm package and the official MCP Registry entry,
via [`.github/workflows/publish-mcp.yml`](.github/workflows/publish-mcp.yml):

```bash
# 1. bump the version in package.json, server.json (both "version" fields),
#    src/index.ts and .claude-plugin/plugin.json; rebuild + commit:
npm run build && git commit -am "release: vX.Y.Z"

# 2. tag and push — CI does the rest:
git tag vX.Y.Z && git push origin main --tags
```

The workflow checks the tag matches `package.json`, builds, `npm publish`es (with
provenance), then authenticates to the registry with **GitHub OIDC** (no secret)
and publishes `server.json`. It hosts only metadata pointing at the npm package,
so the npm publish runs first.

**One‑time setup:** add an `NPM_TOKEN` secret (repo → Settings → Secrets → Actions).
To drop the token entirely, configure npm **trusted publishing** (OIDC) for
`@clocknext/mcp` on npmjs.com and delete the `NODE_AUTH_TOKEN` line.

<details>
<summary>Manual release (no CI)</summary>

```bash
npm publish --access public                 # npm first — the registry validates against it
# get the publisher CLI (Linux/macOS, no brew needed):
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher
./mcp-publisher login github                # device flow — must be a ClockNext org member
./mcp-publisher publish                     # reads server.json (name io.github.ClockNext/mcp)
```
</details>

See the [MCP Registry docs](https://modelcontextprotocol.io/registry/about).
