# @clocknext/mcp

The **ClockNext MCP server** — meter usage, verify signals, and manage
usage‑based billing directly from AI coding tools (Claude Code, Cursor, Codex,
Antigravity) and any other [Model Context Protocol](https://modelcontextprotocol.io)
client.

It runs **locally over stdio**: your AI tool spawns it as a subprocess, and your
organisation's `cnk_…` API key stays in the server's environment — never in the
model's context.

## Install as a Claude Code plugin (recommended)

In Claude Code:

```
/plugin marketplace add ClockNext/clocknext-mcp
/plugin install clocknext@clocknext
```

Claude Code prompts for your ClockNext API key at install (stored securely) and
wires the server up automatically — no manual config, no env vars. Run `/mcp` to
confirm the `clocknext` tools are available.

## Manual setup (other MCP clients)

You need a ClockNext API key (Settings → API Keys). Then add the server to your
tool's MCP config.

**Claude Code**

```bash
claude mcp add clocknext --env CLOCKNEXT_API_KEY=cnk_your_key -- npx -y @clocknext/mcp
```

**Cursor / Windsurf / Antigravity** — `.cursor/mcp.json` (or the tool's MCP JSON):

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

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.clocknext]
command = "npx"
args = ["-y", "@clocknext/mcp"]
env = { CLOCKNEXT_API_KEY = "cnk_your_key" }
```

### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `CLOCKNEXT_API_KEY` | yes | Your org's `cnk_…` key (Settings → API Keys). |
| `CLOCKNEXT_BASE_URL` | no | Override the API origin (e.g. a staging URL). Defaults to production. |

## Tools

| Tool | What it does |
| --- | --- |
| `clocknext_whoami` | Identify the org behind the key and whether it's **sandbox** or **live**. Call first. |
| `clocknext_list_models` | List enabled models + USD prices per 1M tokens. Use a `modelId` in signals. |
| `clocknext_verify_signal` | **Dry run** — validate + price a signal without recording it. Preflight your setup. |
| `clocknext_record_usage` | Record one real (billed) usage signal. Supports an `idempotencyKey` for safe retries. |

A typical agent flow: `whoami` → `list_models` → `verify_signal` (confirm the
customer/model/plan price correctly) → `record_usage`.

## Development

```bash
npm install          # links the local @clocknext/sdk (file:../clocknext-sdk)
npm run build        # tsup → dist/index.js (executable bin)
npm run dev          # run from source via tsx
CLOCKNEXT_API_KEY=cnk_... npm start
```

Built on the official `@modelcontextprotocol/sdk` over `@clocknext/sdk`. stdio
today; a hosted Streamable‑HTTP variant is planned. Logs go to **stderr** (stdout
is the protocol channel).
