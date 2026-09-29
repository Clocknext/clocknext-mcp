import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNextApi } from "../api";
import { errMsg, errorResult, jsonResult } from "./util";

/**
 * Composite catalogue tools — list and create the bundles that are grouped
 * under one tag and billed as a single thing.
 *
 * These live outside `catalogue.ts` on purpose. That file generates four
 * identical CRUD sets (create / get / list / update / archive / unarchive)
 * from one factory, and a composite has no update or archive endpoint on the
 * public API — only list and create. Bending the factory to emit two of six
 * tools for one resource would make the other four look like an oversight
 * rather than a deliberate absence.
 *
 * The money boundary an agent has to understand: creating a composite prices
 * it but charges nobody. An invoice is built from plan components, never from
 * a catalogue entry, so a composite only starts costing money when a plan
 * SELLS it. That second step is `clocknext_create_plan` with a
 * `PRICING_METRIC` component — the wire still uses the old name for it.
 */
export function registerCompositeTools(server: McpServer, cnk: ClockNextApi): void {
  server.registerTool(
    "clocknext_list_composites",
    {
      title: "ClockNext: list composites",
      description: [
        "List the organisation's composites — bundles of credits / outcomes / units grouped under one tag and billed as ONE thing. Returns each composite's `id` (what a plan's PRICING_METRIC component sends as pricingMetricId) and `refId` (what the product's code puts in a signal's composite tag), plus the catalogue items it is restricted to, with their agentKeys.",
        "",
        "Rules:",
        "- Call this BEFORE tagging any signal with a composite: only a live composite's refId resolves, and a tag naming nothing is silently ignored rather than rejected — so a typo looks exactly like success.",
        "- Call it BEFORE clocknext_create_plan / clocknext_update_plan too: the `id` here is what a PRICING_METRIC component references as pricingMetricId. `id` and `refId` are NOT interchangeable — the plan wants the id, the signal wants the refId.",
        "- A composite is restricted to a set of credits/outcomes/units. Only signals naming something in that set may carry its tag. Empty lists mean unrestricted (legacy rows only).",
        "- Pass active=true for only the ones a new signal can still be tagged with. Archived composites keep every row they already own.",
        "- READ-ONLY resource beyond create: there is no update and no archive tool for composites. If the user wants one changed, say so plainly and send them to the ClockNext product (https://payments.clocknext.com/pricing-metrics) — never create a second composite as a workaround, since the old one keeps resolving and both stay live.",
      ].join("\n"),
      inputSchema: {
        active: z
          .boolean()
          .optional()
          .describe(
            "Only return composites that still accept new traffic. Omit to include archived ones too.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ active }) => {
      try {
        return jsonResult(
          await cnk.composites.list(active === undefined ? {} : { active }),
        );
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    "clocknext_create_composite",
    {
      title: "ClockNext: create composite",
      description: [
        "Create a composite — a bundle of credits / outcomes / units that is grouped under one tag and billed as ONE thing instead of per item. Use it when several metered steps together make up one sellable unit of work (a call, a job, a document).",
        "",
        "Rules:",
        "- `refId` is the integration contract: it is what the product's code sends as a signal's compositeRef. Lowercased; letters, digits, _ and - only. It may NOT collide with a field the ingest body already owns (customerId, usage, agentKey, runId, member, custom, composite, …) — a collision is refused here, not silently ignored later.",
        "- `entitlements` is REQUIRED — at least one credit / outcome / unit id. A composite restricted to nothing would accept every signal in the organisation. Get the ids from clocknext_list_credits / clocknext_list_outcomes / clocknext_list_units (ids, not agentKeys).",
        "- `price` is what ONE occurrence costs once a plan sells this. Creating a composite CHARGES NOBODY: an invoice is built from plan components, never from a catalogue entry.",
        "- To actually bill it, add it to a plan with clocknext_create_plan / clocknext_update_plan as a component of type PRICING_METRIC (the wire still uses the old name), passing the id this tool returns as `pricingMetricId`, plus a billingMode and, for ADVANCE, a quantity — that quantity is a prepaid pool of slots shared across the wrapped items. Tell the user this second step is required, or they will wonder why a composite they created bills nothing.",
        "- A composite CANNOT BE EDITED once created — not from this tool, not from any tool here. There is no update and no archive on the public API: name, refId, price, description and which items it wraps are all frozen the moment this call succeeds. Changing any of them means doing it manually in the ClockNext product (https://payments.clocknext.com/pricing-metrics).",
        "- So get it right the FIRST time: read the whole definition back to the user and get an explicit yes before calling this. If they later ask you to change a composite, do not hunt for a tool and do not create a near-duplicate — say plainly that composites can only be edited manually in the ClockNext product, and point them there.",
      ].join("\n"),
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(80)
          .describe("Human-readable name, e.g. 'Voice AI call'."),
        refId: z
          .string()
          .min(1)
          .max(80)
          .describe(
            "The tag identifier the product's code will send (e.g. 'voice_ai'). Lowercased; letters, digits, _ and - only; must not collide with a reserved ingest field.",
          ),
        price: z
          .number()
          .min(0)
          .describe(
            "USD charged per completed occurrence once a plan sells this composite. Ask the user — do not invent a price.",
          ),
        description: z
          .string()
          .max(400)
          .optional()
          .describe("Optional note about what this bundle represents."),
        creditIds: z
          .array(z.string())
          .optional()
          .describe("Credit ids to restrict this composite to (from clocknext_list_credits)."),
        outcomeIds: z
          .array(z.string())
          .optional()
          .describe("Outcome ids to restrict this composite to (from clocknext_list_outcomes)."),
        unitIds: z
          .array(z.string())
          .optional()
          .describe("Unit ids to restrict this composite to (from clocknext_list_units)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, refId, price, description, creditIds, outcomeIds, unitIds }) => {
      // Checked here rather than left to the server so the agent gets the
      // actionable message ("go list the catalogue") instead of a 400 whose
      // wording is aimed at the ClockNext product's picker.
      const total =
        (creditIds?.length ?? 0) + (outcomeIds?.length ?? 0) + (unitIds?.length ?? 0);
      if (total === 0) {
        return errorResult(
          "A composite must wrap at least one credit, outcome or unit. Call clocknext_list_credits / clocknext_list_outcomes / clocknext_list_units and pass the ids of the items this bundle is made of.",
        );
      }
      try {
        return jsonResult(
          await cnk.composites.create({
            name,
            refId,
            price,
            ...(description ? { description } : {}),
            entitlements: {
              ...(creditIds?.length ? { creditIds } : {}),
              ...(outcomeIds?.length ? { outcomeIds } : {}),
              ...(unitIds?.length ? { unitIds } : {}),
            },
          }),
        );
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}
