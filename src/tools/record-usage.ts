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
      description: [
        "Record ONE real usage signal. Prices the tokens against the model and the customer's plan and returns the resulting usage log.",
        "",
        "Rules:",
        "- Bills for real. For a no-op price preview, use clocknext_verify_signal instead.",
        "- Reuse the SAME idempotencyKey across retries of one event so a lost response can't double-record it.",
      ].join("\n"),
      inputSchema: {
        ...signalShape,
        idempotencyKey: z
          .string()
          .optional()
          .describe(
            "Dedup key. Reuse the SAME value across retries of one logical event; a repeat returns the original result instead of recording again.",
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
