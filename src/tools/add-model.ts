import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errMsg, errorResult, jsonResult } from "./util";

/**
 * clocknext_add_model — enable a model for the org, autopriced from the catalog.
 *
 * MCP-internal on purpose: it POSTs the org's `cnk_` key directly to the
 * (undocumented) `POST /api/v1/models` endpoint, NOT through @clocknext/sdk — so
 * this capability stays off the public SDK and docs surface. Base URL mirrors the
 * SDK's (`CLOCKNEXT_BASE_URL`, default production).
 */

const DEFAULT_BASE = "https://payments.clocknext.com";

export function registerAddModel(server: McpServer): void {
  server.registerTool(
    "clocknext_add_model",
    {
      title: "ClockNext: add (enable) a model",
      description:
        "Enable a model for the organisation so usage can be metered against it — afterwards its `modelId` is valid in clocknext_record_usage / clocknext_verify_signal and appears in clocknext_list_models. AUTOPRICED: give only the `provider` and `model` (its catalog id) and ClockNext copies that model's input/output/cache prices from its pricing catalog — you never set prices here. Fails cleanly if the model isn't in the catalog or is already enabled, so check clocknext_list_models first.",
      inputSchema: {
        provider: z
          .string()
          .min(1)
          .describe(
            "The model's provider slug in the ClockNext catalog, e.g. 'openai', 'anthropic', 'google'.",
          ),
        model: z
          .string()
          .min(1)
          .describe(
            "The model's catalog id, e.g. 'gpt-4o' or 'claude-sonnet-4-6'. This becomes the modelId you send in usage signals.",
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ provider, model }) => {
      const apiKey = process.env.CLOCKNEXT_API_KEY;
      if (!apiKey) {
        return errorResult("CLOCKNEXT_API_KEY is not set — cannot add a model.");
      }
      const base = (process.env.CLOCKNEXT_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");

      try {
        const res = await fetch(new URL("/api/v1/models", base), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ provider, modelId: model, pricingMode: "AUTO" }),
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        if (!res.ok) {
          return errorResult(
            json.error || json.message || `HTTP ${res.status} enabling the model.`,
          );
        }
        return jsonResult({ ok: true, provider, model, ...json });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
