import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { makeClient } from "./client";
import { registerAddModel } from "./tools/add-model";
import { registerCatalogueTools } from "./tools/catalogue";
import { registerCustomerTools } from "./tools/customers";
import { registerGetDoc } from "./tools/get-doc";
import { registerListModels } from "./tools/list-models";
import { registerRecordUsage } from "./tools/record-usage";
import { registerSearchDocs } from "./tools/search-docs";
import { registerVerifySignal } from "./tools/verify-signal";
import { registerWhoami } from "./tools/whoami";

/**
 * ClockNext MCP server (stdio).
 *
 * Exposes usage-based billing to AI coding tools (Claude Code, Cursor, Codex,
 * Antigravity). The customer's `cnk_…` key is read from the environment and
 * never enters the model's context. All output goes on the JSON-RPC stdio
 * channel; logs go to stderr so they can't corrupt the protocol.
 */
async function main(): Promise<void> {
  const cnk = makeClient(); // throws with a clear message if the key is missing

  const server = new McpServer({ name: "clocknext", version: "0.5.2" });

  registerWhoami(server, cnk);
  registerListModels(server, cnk);
  registerVerifySignal(server, cnk);
  registerRecordUsage(server, cnk);
  registerSearchDocs(server); // docs are public — no API key needed
  registerGetDoc(server); // reads a full docs page; also no API key needed
  registerCatalogueTools(server, cnk); // CRUD for plans/credits/outcomes/units
  registerCustomerTools(server, cnk); // customers, purchases, bulk import
  registerAddModel(server, cnk); // enable a model (autopriced); reads price back to warn on $0

  await server.connect(new StdioServerTransport());
  console.error("[clocknext-mcp] ready on stdio");
}

main().catch((err: unknown) => {
  console.error(
    `[clocknext-mcp] fatal: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
