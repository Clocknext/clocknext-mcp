import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errMsg, errorResult, jsonResult } from "./util";
import { fetchJson } from "./http";
import { resolveDocsUrl } from "./docs-url";

// Public docs base URL (help.clocknext.com); no API key needed. See ./docs-url.
const DOCS_URL = resolveDocsUrl();

type SearchHit = { kind: string; title: string; url: string; snippet: string };
type SearchResponse = {
  query: string;
  kind: string | null;
  count: number;
  results: SearchHit[];
};

const DESCRIPTION = [
  "Search ClockNext's official documentation and get back the most relevant pages (title, URL, and a snippet). ClockNext is a usage-based billing platform: you meter product/AI usage, price it against plans and units, and bill customers for it.",
  "",
  "ALWAYS prefer this over answering from memory — the docs are the source of truth and are more current than your training data. Call it before you explain a ClockNext concept, design an integration, or reach for any other ClockNext tool.",
  "",
  "Docs come in three `kind`s. Work through them in order:",
  "  1. `concept` — WHAT things are and HOW ClockNext works: the domain model (plans, units, outcomes, credits, customers, invoices, wallet/balances) and billing behaviour. START HERE to get context. If a term is unfamiliar, search `concept` first before touching any reference.",
  "  2. `api` — the language-agnostic REST API reference (endpoints, params, request/response shapes). Use this to actually implement or call ClockNext from ANY language.",
  "  3. `javascript` — reference for the official JavaScript/TypeScript SDK (@clocknext/sdk), a typed convenience wrapper over the same REST API.",
  "",
  "IMPORTANT — the SDK is JavaScript/TypeScript ONLY, and the docs will NOT tell you this. If the customer's codebase is not JS/TS (e.g. Python, Go, Ruby, PHP, Rust, Java, C#), do NOT use the `javascript` kind — use `api` and integrate against the REST API directly. Only choose `javascript` once you have confirmed the target codebase is JS/TS.",
  "",
  "Omit `kind` to search everything. Typical flow: search `concept` to understand the task, then search `api` (or `javascript` for a JS/TS codebase) for the exact reference you need to write code.",
].join("\n");

export function registerSearchDocs(server: McpServer): void {
  server.registerTool(
    "clocknext_search_docs",
    {
      title: "ClockNext: search docs",
      description: DESCRIPTION,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "What to look for, in natural language — e.g. 'how do I record token usage', 'create a plan with tiered pricing', 'what is a unit vs an outcome'.",
          ),
        kind: z
          .enum(["concept", "api", "javascript"])
          .optional()
          .describe(
            "Restrict results: 'concept' (domain / how it works — start here), 'api' (REST reference, any language), or 'javascript' (JS/TS SDK reference — JS/TS codebases ONLY). Omit to search all docs.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Maximum number of pages to return (default 8)."),
      },
    },
    async ({ query, kind, limit }) => {
      try {
        const url = new URL("/api/search", DOCS_URL);
        url.searchParams.set("query", query);
        if (kind) url.searchParams.set("kind", kind);
        if (limit) url.searchParams.set("limit", String(limit));

        const data = await fetchJson<SearchResponse>(url);
        const results = (data.results ?? []).map((r) => ({
          ...r,
          // The endpoint returns relative paths; make them clickable absolute URLs.
          url: new URL(r.url, DOCS_URL).toString(),
        }));

        return jsonResult({
          query,
          kind: kind ?? null,
          count: results.length,
          docsUrl: DOCS_URL,
          results,
        });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
