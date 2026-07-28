import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNext } from "@clocknext/sdk";
import { buildSignal, signalShape } from "./signal";
import { errMsg, errorResult, jsonResult } from "./util";

export function registerVerifySignal(server: McpServer, cnk: ClockNext): void {
  server.registerTool(
    "clocknext_verify_signal",
    {
      title: "ClockNext: verify signal (dry run)",
      description:
        "Validate and PRICE a usage signal WITHOUT recording it — a dry run. Returns the projected usage log (cost, credits drawn, applied rules) so you can confirm the customer, model, and plan are wired up correctly before sending real traffic. Records nothing and never bills.",
      inputSchema: signalShape,
    },
    async (args) => {
      const signal = buildSignal(args);
      if ("error" in signal) return errorResult(signal.error);
      try {
        const usageLog = await cnk.signals.verify(signal);
        return jsonResult({ dryRun: true, usageLog });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
