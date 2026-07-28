import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNext } from "@clocknext/sdk";
import { errMsg, errorResult, jsonResult } from "./util";

export function registerWhoami(server: McpServer, cnk: ClockNext): void {
  server.registerTool(
    "clocknext_whoami",
    {
      title: "ClockNext: identify workspace",
      description:
        "Identify the ClockNext organisation behind the configured API key, and — crucially — whether it is a 'sandbox' (a disposable staging twin) or the 'live' organisation. Call this FIRST to confirm you are pointed at the intended workspace before recording any real usage.",
      inputSchema: {},
    },
    async () => {
      try {
        return jsonResult(await cnk.workspace.me());
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
