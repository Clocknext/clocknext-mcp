import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNext } from "@clocknext/sdk";
import { errMsg, errorResult, jsonResult } from "./util";

/**
 * clocknext_add_model — enable a model for the org, autopriced from the catalog.
 *
 * MCP-internal on purpose: it POSTs the org's `cnk_` key directly to the
 * (undocumented) `POST /api/v1/models` endpoint, NOT through @clocknext/sdk — so
 * this capability stays off the public SDK and docs surface. Base URL mirrors the
 * SDK's (`CLOCKNEXT_BASE_URL`, default production).
 *
 * Only catalog models are supported. AUTO copies the catalog's prices; when the
 * catalog has no price for a model it is still enabled, but at $0 — the tool
 * then tells the caller to set the price on the Models page (it reads the price
 * back via the SDK to detect this).
 */

const DEFAULT_BASE = "https://payments.clocknext.com";

export function registerAddModel(server: McpServer, cnk: ClockNext): void {
  server.registerTool(
    "clocknext_add_model",
    {
      title: "ClockNext: add (enable) a model",
      description: [
        "Enable a model for the organisation so usage can be metered against it. Afterwards its `modelId` is valid in clocknext_record_usage / clocknext_verify_signal and appears in clocknext_list_models. Autopriced from ClockNext's catalog — you never set prices here.",
        "",
        "Rules:",
        "- Only models in ClockNext's pricing catalog can be added — check clocknext_list_models first.",
        "- If the catalog has no price for it, the model is enabled but meters at $0; the tool returns a Models-page link and a `warning` so you can set pricing.",
      ].join("\n"),
      inputSchema: {
        provider: z
          .string()
          .min(1)
          .describe(
            "Provider slug in the ClockNext catalog, e.g. 'openai', 'anthropic', 'google'.",
          ),
        model: z
          .string()
          .min(1)
          .describe(
            "Catalog model id, e.g. 'gpt-4o' or 'claude-sonnet-4-6'. Becomes the modelId you send in usage signals.",
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
      const modelsPage = `${base}/settings/models`;

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
          statusDetail?: { message?: string };
        };

        if (!res.ok) {
          // Only catalog models are supported, and the server returns the same
          // error whether the MODEL or the PROVIDER is unknown — so guide the
          // caller for both without offering a manual path that won't work.
          const reason =
            json.statusDetail?.message || json.error || json.message || `HTTP ${res.status}`;
          return errorResult(
            `Couldn't add "${provider}/${model}": ${reason}. ClockNext only meters models in its pricing catalog, so a model or provider that isn't in the catalog can't be added or priced here. See the available models with clocknext_list_models, or manage models on the Models page: ${modelsPage}`,
          );
        }

        // Enabled. AUTO copies catalog prices, but the catalog may have none —
        // in which case the model is live at $0 until it's priced in the product.
        // Read the enabled model back to detect that (best-effort).
        const added = await cnk.workspace
          .models({})
          .then((list) => list.find((m) => m.modelId === model))
          .catch(() => undefined);

        const unpriced =
          added != null &&
          added.inputPrice === 0 &&
          added.outputPrice === 0 &&
          added.cachePrice === 0;

        if (unpriced) {
          return jsonResult({
            ok: true,
            provider,
            model,
            priced: false,
            warning: `"${model}" is enabled but has NO price in the catalog — usage will meter at $0. Set its input/output/cache pricing on the Models page: ${modelsPage}`,
            modelsPage,
          });
        }

        return jsonResult({
          ok: true,
          provider,
          model,
          priced: added != null ? true : undefined,
          ...(added
            ? {
                prices: {
                  input: added.inputPrice,
                  output: added.outputPrice,
                  cache: added.cachePrice,
                },
              }
            : {}),
        });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
