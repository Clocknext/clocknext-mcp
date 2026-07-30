import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNext } from "@clocknext/sdk";
import { errMsg, errorResult, jsonResult } from "./util";

/**
 * Operate-mode catalogue tools — CRUD (create / read / update / archive) over the
 * /api/v1 catalogue resources: plans, credits, outcomes, units. These MUTATE the
 * organisation's billing configuration, so they wrap the typed @clocknext/sdk
 * methods rather than letting a model assemble raw API calls.
 *
 * "Archive" maps to `setActive(id, false)` — a reversible deactivation, NOT a hard
 * delete (hard delete exists on the SDK but is intentionally not exposed here).
 */

// ---------- shared field schemas ----------

const modelBundle = z
  .array(
    z.object({
      orgModelId: z.string().describe("A model id from clocknext_list_models."),
      modelName: z
        .string()
        .optional()
        .describe("Display label; the server defaults it from the model when omitted."),
      tokens: z.number().describe("Total tokens this bundle entry represents."),
      input: z.number().describe("Input tokens."),
      output: z.number().describe("Output tokens."),
      cache: z.number().describe("Cache tokens."),
    }),
  )
  .optional()
  .describe("Optional per-model token allocation mapping for this entitlement.");

// Plan component: flattened discriminated union. The per-type rules below are
// enforced by the server (clean 422 on violation); the field notes guide the agent.
const planComponent = z
  .object({
    type: z
      .enum(["WALLET", "FLAT", "CREDIT", "OUTCOME", "UNIT"])
      .describe("The meter type of this entitlement line."),
    billingMode: z
      .enum(["ADVANCE", "ARREAR"])
      .describe(
        "ADVANCE bills up-front for the cycle (needs amount/quantity); ARREAR meters and bills what was consumed.",
      ),
    amount: z
      .number()
      .optional()
      .describe(
        "WALLET or FLAT only, and REQUIRED for them (USD). WALLET = prepaid balance; FLAT = one-off fee.",
      ),
    creditId: z
      .string()
      .optional()
      .describe("CREDIT only: id of an existing credit (clocknext_list_credits)."),
    outcomeId: z
      .string()
      .optional()
      .describe("OUTCOME only: id of an existing outcome (clocknext_list_outcomes)."),
    unitId: z
      .string()
      .optional()
      .describe("UNIT only: id of an existing unit (clocknext_list_units)."),
    quantity: z
      .number()
      .optional()
      .describe(
        "CREDIT/OUTCOME/UNIT only: the granted quantity — REQUIRED when billingMode is ADVANCE, omit when ARREAR (metered).",
      ),
  })
  .describe("One entitlement line in the plan.");

const unitTier = z.object({
  upTo: z
    .number()
    .nullable()
    .describe("Upper bound of this tier; only the LAST tier may be null (unbounded)."),
  price: z.number().describe("Price for this tier."),
});

// ---------- per-resource create/update input shapes (update == create) ----------

const planInput: z.ZodRawShape = {
  name: z.string().describe("Plan name."),
  description: z.string().nullish().describe("Optional description."),
  billingCycle: z
    .enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY", "EVERY_5_MIN", "FREE"])
    .describe("Billing cadence. FREE plans must be ADVANCE-only with no FLAT component."),
  carryForward: z
    .boolean()
    .optional()
    .describe("Carry an unused balance into the next cycle. Default true."),
  currencyCode: z.string().optional().describe("ISO 4217 (3 letters). Default USD."),
  isActive: z.boolean().optional().describe("Whether the plan is active/sellable."),
  components: z
    .array(planComponent)
    .min(1)
    .describe(
      "At least one entitlement line. CREDIT/OUTCOME/UNIT components reference an existing resource by id — create those first.",
    ),
};

const creditInput: z.ZodRawShape = {
  name: z.string().describe("Credit name."),
  agentKey: z
    .string()
    .describe(
      "Lowercased stable key your code passes to signals.credit({ agentKey }). The credit's durable identity.",
    ),
  basePrice: z.number().describe("Base cost per credit before margin."),
  marginPercent: z.number().describe("Margin percent applied over basePrice."),
  pricePerCredit: z.number().describe("Final price charged per credit."),
  description: z.string().optional(),
  tokensPerCredit: z
    .number()
    .optional()
    .describe("If this credit meters LLM tokens: how many tokens equal one credit."),
  modelBundle,
};

const outcomeInput: z.ZodRawShape = {
  name: z.string().describe("Outcome name."),
  basePrice: z.number().describe("Base cost per outcome before margin."),
  marginPercent: z.number().describe("Margin percent applied over basePrice."),
  pricePerOutcome: z.number().describe("Final price charged per completed outcome."),
  description: z.string().nullish(),
  isActive: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        name: z.string().describe("Step name (unique within the outcome)."),
        agentKey: z
          .string()
          .describe("Lowercased stable key your code passes to signals.outcome({ agentKey })."),
        basePrice: z.number().describe("Base price for this step."),
        modelBundle,
      }),
    )
    .min(1)
    .max(50)
    .describe("1–50 steps; step names and agent keys must each be unique."),
};

const unitInput: z.ZodRawShape = {
  name: z.string().describe("Unit name."),
  agentKey: z
    .string()
    .describe(
      "Lowercased stable key consumption is reported against (signals.unit({ agentKey })). The unit's durable identity — unique org-wide, chars [a-z0-9._-]; a rename never changes it.",
    ),
  pricingType: z
    .enum(["FLAT", "SLAB", "VOLUME"])
    .describe("FLAT = a single per-event price; SLAB/VOLUME = tiered pricing."),
  flatPrice: z.number().optional().describe("FLAT only: price per event. Defaults to 0."),
  tiers: z
    .array(unitTier)
    .max(50)
    .optional()
    .describe("SLAB/VOLUME only: 1–50 tiers, ordered; only the last may have upTo:null."),
  description: z.string().nullish(),
  isActive: z.boolean().optional(),
};

// ---------- the CRUD factory ----------

interface Api {
  list: (params: { active?: boolean }) => Promise<unknown>;
  get: (id: string) => Promise<unknown>;
  create: (input: unknown) => Promise<unknown>;
  update: (id: string, input: unknown) => Promise<unknown>;
  setActive: (id: string, active: boolean) => Promise<unknown>;
}

function registerCrud(
  server: McpServer,
  opts: {
    resource: string; // singular, e.g. "plan"
    plural: string; // e.g. "plans"
    api: Api;
    input: z.ZodRawShape;
    desc: { list: string; get: string; create: string; update: string; archive: string };
  },
): void {
  const { resource, plural, api, input, desc } = opts;

  server.registerTool(
    `clocknext_list_${plural}`,
    {
      title: `ClockNext: list ${plural}`,
      description: desc.list,
      inputSchema: {
        active: z
          .boolean()
          .optional()
          .describe(`Only return active ${plural} when true; omit to return all.`),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ active }) => {
      try {
        const rows = await api.list(active === undefined ? {} : { active });
        return jsonResult({
          count: Array.isArray(rows) ? rows.length : undefined,
          [plural]: rows,
        });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    `clocknext_get_${resource}`,
    {
      title: `ClockNext: get ${resource}`,
      description: desc.get,
      inputSchema: { id: z.string().describe(`The ${resource} id.`) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        return jsonResult(await api.get(id));
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    `clocknext_create_${resource}`,
    {
      title: `ClockNext: create ${resource}`,
      description: desc.create,
      inputSchema: input,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const res = await api.create(args);
        return jsonResult(res ?? { ok: true });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    `clocknext_update_${resource}`,
    {
      title: `ClockNext: update ${resource}`,
      description: desc.update,
      inputSchema: {
        id: z.string().describe(`The ${resource} id to update.`),
        ...input,
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const { id, ...rest } = args as { id: string } & Record<string, unknown>;
        const res = await api.update(id, rest);
        return jsonResult(res ?? { ok: true });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );

  server.registerTool(
    `clocknext_archive_${resource}`,
    {
      title: `ClockNext: archive ${resource}`,
      description: desc.archive,
      inputSchema: { id: z.string().describe(`The ${resource} id to archive (deactivate).`) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      try {
        const res = await api.setActive(id, false);
        return jsonResult(res ?? { ok: true, archived: id });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}

// ---------- wire the four resources ----------

export function registerCatalogueTools(server: McpServer, cnk: ClockNext): void {
  registerCrud(server, {
    resource: "plan",
    plural: "plans",
    api: {
      list: (p) => cnk.plans.list(p),
      get: (id) => cnk.plans.get(id),
      create: (i) => cnk.plans.create(i as never),
      update: (id, i) => cnk.plans.update(id, i as never),
      setActive: (id, a) => cnk.plans.setActive(id, a),
    },
    input: planInput,
    desc: {
      list: "List the organisation's billing plans (id, name, billing cycle, price, active). Use it to find a plan id or to see what's on offer. Pass active=true for only sellable plans.",
      get: "Get one plan in full by id — its entitlement components (wallet/credit/outcome/unit/flat), billing cycle, currency and active state.",
      create:
        "Create a billing plan. A plan bundles one or more entitlement `components`: WALLET (prepaid USD balance), FLAT (one-off fee), or CREDIT/OUTCOME/UNIT entitlements that reference an existing credit/outcome/unit BY ID — so create those first (clocknext_create_credit / _outcome / _unit) and list them to get ids. Each component has a billingMode: ADVANCE (up-front, needs amount/quantity) or ARREAR (metered). FREE plans must be ADVANCE-only with no FLAT component. If a term is unclear, clocknext_search_docs kind=concept first. This creates a real, sellable plan — get the pricing right before you create it.",
      update:
        "Replace a plan by id with a COMPLETE new definition (same shape as create — a full rewrite, not a patch; omitted fields are dropped). Changes the plan going forward; customers already on it keep their terms. Read it first with clocknext_get_plan, edit, then send the whole thing back.",
      archive:
        "Archive (deactivate) a plan by id — it becomes unsellable, existing customers are unaffected. Reversible (set isActive:true via update). Does NOT hard-delete.",
    },
  });

  registerCrud(server, {
    resource: "credit",
    plural: "credits",
    api: {
      list: (p) => cnk.credits.list(p),
      get: (id) => cnk.credits.get(id),
      create: (i) => cnk.credits.create(i as never),
      update: (id, i) => cnk.credits.update(id, i as never),
      setActive: (id, a) => cnk.credits.setActive(id, a),
    },
    input: creditInput,
    desc: {
      list: "List the organisation's credit types (id, name, agentKey, price, active). Use it to find a credit id to reference from a plan's CREDIT component.",
      get: "Get one credit type in full by id — pricing, token mapping and active state.",
      create:
        "Create a credit type: a named entitlement your code draws down via signals.credit({ agentKey }). `agentKey` is the lowercased stable key that ties runtime signals to this credit. Priced as basePrice + marginPercent → pricePerCredit; optionally map LLM tokens to credits (tokensPerCredit + per-model modelBundle). A plan grants it via a CREDIT component referencing this credit's id. (Returns ok with no body — list credits to see the new id.)",
      update:
        "Replace a credit type by id with a complete new definition (full rewrite, same shape as create). Changing `agentKey` re-points which runtime signals map here — do it deliberately.",
      archive:
        "Archive (deactivate) a credit type by id. Reversible; does NOT hard-delete. Plans still referencing it should be updated.",
    },
  });

  registerCrud(server, {
    resource: "outcome",
    plural: "outcomes",
    api: {
      list: (p) => cnk.outcomes.list(p),
      get: (id) => cnk.outcomes.get(id),
      create: (i) => cnk.outcomes.create(i as never),
      update: (id, i) => cnk.outcomes.update(id, i as never),
      setActive: (id, a) => cnk.outcomes.setActive(id, a),
    },
    input: outcomeInput,
    desc: {
      list: "List the organisation's outcome types (id, name, price, active). Use it to find an outcome id to reference from a plan's OUTCOME component.",
      get: "Get one outcome type in full by id — its steps plus in-flight/completed stats.",
      create:
        "Create an outcome type: a multi-step deliverable billed per COMPLETED outcome. It has 1–50 `steps`, each with its own lowercased agentKey (used by signals.outcome({ agentKey })) and basePrice. Priced basePrice + marginPercent → pricePerOutcome. A plan grants it via an OUTCOME component referencing this outcome's id.",
      update:
        "Replace an outcome type by id with a complete new definition (full rewrite, same shape as create). Step agent keys are the runtime binding — change them deliberately.",
      archive:
        "Archive (deactivate) an outcome type by id. Reversible; does NOT hard-delete.",
    },
  });

  registerCrud(server, {
    resource: "unit",
    plural: "units",
    api: {
      list: (p) => cnk.units.list(p),
      get: (id) => cnk.units.get(id),
      create: (i) => cnk.units.create(i as never),
      update: (id, i) => cnk.units.update(id, i as never),
      setActive: (id, a) => cnk.units.setActive(id, a),
    },
    input: unitInput,
    desc: {
      list: "List the organisation's unit types (id, name, pricing type, active). Use it to find a unit id to reference from a plan's UNIT component.",
      get: "Get one unit type in full by id — pricing type, flat price or tiers, plus usage stats.",
      create:
        "Create a unit type: a metered usage unit reported against a lowercased stable `agentKey` (signals.unit({ agentKey })) — its durable identity, unique org-wide. Price it FLAT (a single `flatPrice` per event, default 0) or tiered — pricingType SLAB or VOLUME with `tiers` (1–50, ordered; only the last tier may have upTo:null). A plan meters it via a UNIT component referencing this unit's id.",
      update:
        "Replace a unit type by id with a complete new definition (full rewrite, same shape as create, including `agentKey`). Changing `agentKey` re-points which runtime signals map here — do it deliberately.",
      archive: "Archive (deactivate) a unit type by id. Reversible; does NOT hard-delete.",
    },
  });
}
