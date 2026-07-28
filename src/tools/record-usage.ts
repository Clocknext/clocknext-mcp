import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNext } from "@clocknext/sdk";
import { z } from "zod";
import { buildSignal, signalShape } from "./signal";
import { errMsg, errorResult, jsonResult } from "./util";

export function registerRecordUsage(server: McpServer, cnk: ClockNext): void {
  server.registerTool(
    "clocknext_record_usage",
    {
      title: "ClockNext: record usage",
      description:
        "Record ONE real usage signal — it is metered and billed. Prices the tokens against the model and the customer's plan and returns the resulting usage log. Pass an idempotencyKey to make retries safe (a repeat with the same key returns the original result instead of double-recording). For a no-op preflight, use clocknext_verify_signal instead.",
      inputSchema: {
        ...signalShape,
        idempotencyKey: z
          .string()
          .optional()
          .describe(
            "Optional dedup key. Reuse the SAME key across retries of one logical event so a lost response can't double-record it.",
          ),
      },
      annotations: { idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const signal = buildSignal(args);
      if ("error" in signal) return errorResult(signal.error);
      try {
        const res = await cnk.signals.track(signal, { wait: true });
        return jsonResult({ recorded: true, usageLog: res.usageLog });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
