import { z } from "zod";
import type {
  ClockNext,
  CreateCustomerInput,
  CreatePurchaseInput,
} from "@clocknext/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errMsg, errorResult, jsonResult } from "./util";

/**
 * Customer tools — create/read customers, subscribe them to a plan (purchase),
 * and a bulk import. These wrap existing @clocknext/sdk methods (no server change
 * needed). They power the onboarding skill's "dummy customer + test signal" step
 * and the customer-mapping / bulk-import skills.
 */

// Shared customer profile fields. `name` + `email` are required on create.
const customerFields = {
  name: z.string().min(1).describe("Customer / company name."),
  email: z
    .string()
    .min(1)
    .describe("Primary email — required, and the key bulk import matches back on."),
  description: z.string().nullish(),
  website: z.string().nullish().describe("The customer's website."),
  phone: z.string().nullish(),
  legalName: z.string().nullish(),
  addressLine1: z.string().nullish(),
  addressLine2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  pincode: z.string().nullish(),
  taxId: z.string().nullish(),
  notes: z.string().nullish(),
  logoUrl: z.string().nullish(),
  creditAllowance: z.number().optional(),
  currencyCode: z
    .string()
    .optional()
    .describe("ISO 4217 (3 letters); must be enabled for the org. Defaults to the org currency."),
} satisfies z.ZodRawShape;

const customerObject = z.object(customerFields);

export function registerCustomerTools(server: McpServer, cnk: ClockNext): void {
  server.registerTool(
    "clocknext_create_customer",
    {
      title: "ClockNext: create customer",
      description:
        "Create a ClockNext customer — the entity you bill (maps to one of your end-users / tenants / organisations). `name` and `email` are required; everything else is optional profile. Returns the customer with its ClockNext `id`, which you pass as `customerId` when subscribing to a plan (clocknext_create_purchase) and when recording usage (clocknext_record_usage).",
      inputSchema: customerFields,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await cnk.customers.create(args as CreateCustomerInput));
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    "clocknext_get_customer",
    {
      title: "ClockNext: get customer",
      description: "Fetch one customer by ClockNext id.",
      inputSchema: { id: z.string().describe("The ClockNext customer id.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        return jsonResult(await cnk.customers.get(id));
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    "clocknext_list_customers",
    {
      title: "ClockNext: list customers",
      description:
        "List / search the org's customers, most-recent first (cursor-paginated). Use it to find a customer id or check whether one already exists before creating.",
      inputSchema: {
        q: z.string().optional().describe("Search by name or email."),
        limit: z.number().int().min(1).max(100).optional().describe("Max customers per page."),
        cursor: z.string().optional().describe("Pagination cursor from a previous page's nextCursor."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await cnk.customers.list(args));
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    "clocknext_create_purchase",
    {
      title: "ClockNext: subscribe customer to a plan",
      description:
        "Subscribe a customer to a plan (a 'purchase') — this is what activates the plan for that customer. A usage signal only prices if the customer has an active plan whose components match the meter (credit / outcome / unit), so do this after clocknext_create_customer + clocknext_create_plan. Used to wire up a dummy customer before firing test signals.",
      inputSchema: {
        customerId: z
          .string()
          .describe("The ClockNext customer id (from clocknext_create_customer / _list_customers)."),
        planId: z.string().describe("The plan id to subscribe them to (from clocknext_create_plan / _list_plans)."),
        billingDate: z
          .string()
          .optional()
          .describe("YYYY-MM-DD. Defaults to today; must be a valid, non-past date."),
        notes: z.string().optional(),
        autoPayment: z.boolean().optional().describe("Charge automatically when the invoice is due."),
        voidAfterMinutes: z
          .number()
          .optional()
          .describe("Auto-void the purchase if it stays unpaid after N minutes."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        return jsonResult(await cnk.purchases.create(args as CreatePurchaseInput));
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    "clocknext_bulk_import_customers",
    {
      title: "ClockNext: bulk import customers",
      description:
        "Bulk-create ClockNext customers in ONE request — for backfilling an existing user base. Pass an array of customers (each needs name + email; up to 200 per call). The whole batch goes to the server in a single call and comes back with a PER-ROW result — created id, or an error — so one duplicate/bad row never aborts the batch. Match results back to your users by email. Runs against a private, MCP-only bulk endpoint (no SDK / public API); for a larger base, call it again in ≤200-row chunks.",
      inputSchema: {
        customers: z
          .array(customerObject)
          .min(1)
          .max(200)
          .describe("The customers to create (name + email required each; ≤200 per call)."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ customers }) => {
      const apiKey = process.env.CLOCKNEXT_API_KEY;
      if (!apiKey) {
        return errorResult("CLOCKNEXT_API_KEY is not set — cannot import customers.");
      }
      const base = (
        process.env.CLOCKNEXT_BASE_URL || "https://payments.clocknext.com"
      ).replace(/\/+$/, "");
      try {
        const res = await fetch(new URL("/api/v1/customers/bulk", base), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ customers }),
          signal: AbortSignal.timeout(60_000), // one batch request; allow headroom
        });
        const json = (await res.json().catch(() => ({}))) as {
          result?: unknown;
          statusDetail?: { message?: string };
        };
        if (!res.ok) {
          return errorResult(
            json.statusDetail?.message || `HTTP ${res.status} on bulk import.`,
          );
        }
        return jsonResult(json.result ?? json);
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
