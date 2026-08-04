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
 * Credit / outcome PRICING is model-grounded: the tool takes a `models` mixer
 * (enabled catalog model + avg tokens + input/output/cache split), reads the org's
 * live per-1M-token prices via list_models, and COMPUTES the base price + margin —
 * an agent can never hand-type an ungrounded price here. (The dashboard mixer is
 * still the preferred, first-class way to price — it previews live and stores the
 * full per-model bundle; these tools are the fallback and store the computed price
 * only.)
 *
 * "Archive" maps to `setActive(id, false)` — a reversible deactivation, NOT a hard
 * delete (hard delete exists on the SDK but is intentionally not exposed here).
 */

// ---------- shared field schemas ----------

/** One line of a pricing mixer: an enabled catalog model + how many tokens it
 *  uses on average, split across input/output/cache as PERCENTAGES that total 100. */
const mixerLine = z.object({
  model: z
    .string()
    .describe(
      "Catalog model id from clocknext_list_models (e.g. 'gpt-4o'). Must be enabled — this grounds the price in that model's live per-1M-token cost.",
    ),
  avgTokens: z
    .number()
    .positive()
    .describe("Average TOTAL tokens this uses per credit / per step (input + output + cache combined)."),
  inputPct: z.number().min(0).max(100).describe("Percent of avgTokens that are input tokens."),
  outputPct: z.number().min(0).max(100).describe("Percent that are output tokens."),
  cachePct: z
    .number()
    .min(0)
    .max(100)
    .default(0)
    .describe("Percent that are cache tokens (default 0). inputPct + outputPct + cachePct must total 100."),
});

type MixerLine = { model: string; avgTokens: number; inputPct: number; outputPct: number; cachePct?: number };

/**
 * Compute a model-grounded base price (USD) from a mixer, using the org's LIVE
 * model prices. Rejects a model that isn't enabled/active or a split that doesn't
 * total 100, so a price can never be grounded in a disabled/unknown model.
 */
async function computeMixerBase(
  cnk: ClockNext,
  lines: readonly MixerLine[],
): Promise<{ ok: true; basePrice: number } | { ok: false; error: string }> {
  let models;
  try {
    models = await cnk.workspace.models({});
  } catch (err) {
    return { ok: false, error: `Could not load models to price against: ${errMsg(err)}` };
  }
  const byId = new Map(models.map((m) => [m.modelId.toLowerCase(), m]));

  let basePrice = 0;
  for (const line of lines) {
    const m = byId.get(line.model.toLowerCase());
    if (!m) {
      return {
        ok: false,
        error: `Model "${line.model}" isn't enabled in this workspace — enable it with clocknext_add_model, or check clocknext_list_models for the exact id.`,
      };
    }
    if (!m.isActive) {
      return {
        ok: false,
        error: `Model "${line.model}" is turned off — re-enable it before pricing against it.`,
      };
    }
    const cachePct = line.cachePct ?? 0;
    const total = line.inputPct + line.outputPct + cachePct;
    if (Math.round(total) !== 100) {
      return {
        ok: false,
        error: `For model "${line.model}", inputPct + outputPct + cachePct must total 100 (got ${total}).`,
      };
    }
    // Prices are USD per 1,000,000 tokens (same basis as the pricing engine).
    const perToken =
      (line.inputPct / 100) * m.inputPrice +
      (line.outputPct / 100) * m.outputPrice +
      (cachePct / 100) * m.cachePrice;
    basePrice += (line.avgTokens * perToken) / 1_000_000;
  }
  return { ok: true, basePrice };
}

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
        "WALLET or FLAT only, and REQUIRED for them (USD). WALLET = prepaid balance (debited at raw model cost — NO margin); FLAT = one-off fee.",
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
      "Lowercased stable key you report credit usage against (sent as `agentKey` when recording usage). The credit's durable identity.",
    ),
  models: z
    .array(mixerLine)
    .min(1)
    .describe(
      "The model mixer that GROUNDS the price — one or more enabled catalog models with avg tokens + input/output/cache split. The tool reads live prices and computes the base cost; you never type a raw price.",
    ),
  marginPercent: z
    .number()
    .describe("Markup over the computed base cost, as a percent (e.g. 100 = double the base = pricePerCredit)."),
  tokensPerCredit: z
    .number()
    .optional()
    .describe("How many tokens equal one credit (defaults to 0). Governs how usage draws the credit down."),
  description: z.string().optional().describe("Optional human-readable description."),
};

const outcomeStep = z.object({
  name: z.string().describe("Step name (unique within the outcome)."),
  agentKey: z
    .string()
    .describe("Lowercased stable key you report this outcome step against (sent as `agentKey` when recording usage)."),
  models: z
    .array(mixerLine)
    .min(1)
    .describe(
      "The model mixer grounding THIS step's price (avg tokens + split for the model(s) this step calls). Every outcome step is an LLM step — a non-LLM, fixed-cost event should be a UNIT, not an outcome step.",
    ),
});

const outcomeInput: z.ZodRawShape = {
  name: z.string().describe("Outcome name."),
  description: z.string().nullish().describe("Optional human-readable description."),
  isActive: z.boolean().optional().describe("Whether the outcome is active/sellable."),
  marginPercent: z
    .number()
    .describe("Markup over the summed step base costs, as a percent (e.g. 100 = double = pricePerOutcome)."),
  steps: z
    .array(outcomeStep)
    .min(1)
    .max(50)
    .describe("1–50 steps; each grounded by its own model mixer. Step names and agent keys must each be unique."),
};

const unitInput: z.ZodRawShape = {
  name: z.string().describe("Unit name."),
  agentKey: z
    .string()
    .describe(
      "Lowercased stable key consumption is reported against (sent as `agentKey` when recording unit usage). The unit's durable identity — unique org-wide, chars [a-z0-9._-]; a rename never changes it.",
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
  description: z.string().nullish().describe("Optional human-readable description."),
  isActive: z.boolean().optional().describe("Whether the unit is active/sellable."),
};

// ---------- the CRUD factory ----------

interface Api {
  list: (params: { active?: boolean }) => Promise<unknown>;
  get: (id: string) => Promise<unknown>;
  create: (input: unknown) => Promise<unknown>;
  update: (id: string, input: unknown) => Promise<unknown>;
  setActive: (id: string, active: boolean) => Promise<unknown>;
}

/** Transforms tool args into the API create/update payload — used by credit /
 *  outcome to turn a `models` mixer into a computed base price. Returns an error
 *  string (surfaced to the caller) instead of throwing. */
type PriceInput = (
  args: Record<string, unknown>,
) => Promise<Record<string, unknown> | { error: string }>;

function registerCrud(
  server: McpServer,
  opts: {
    resource: string; // singular, e.g. "plan"
    plural: string; // e.g. "plans"
    api: Api;
    input: z.ZodRawShape;
    desc: { list: string; get: string; create: string; update: string; archive: string };
    priceInput?: PriceInput;
  },
): void {
  const { resource, plural, api, input, desc, priceInput } = opts;

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
        let payload: Record<string, unknown> = args;
        if (priceInput) {
          const priced = await priceInput(args);
          if ("error" in priced) return errorResult(priced.error as string);
          payload = priced;
        }
        const res = await api.create(payload);
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
        let payload: Record<string, unknown> = rest;
        if (priceInput) {
          const priced = await priceInput(rest);
          if ("error" in priced) return errorResult(priced.error as string);
          payload = priced;
        }
        const res = await api.update(id, payload);
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
      inputSchema: { id: z.string().describe(`The ${resource} id to deactivate (soft-archive — reversible, not a delete).`) },
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
        "Create a billing plan. A plan bundles one or more entitlement `components`: WALLET (prepaid USD balance, debited at raw model cost — NO margin), FLAT (one-off fee), or CREDIT/OUTCOME/UNIT entitlements that reference an existing credit/outcome/unit BY ID — so create those first (clocknext_create_credit / _outcome / _unit) and list them to get ids. Each component has a billingMode: ADVANCE (up-front, needs amount/quantity) or ARREAR (metered). FREE plans must be ADVANCE-only with no FLAT component. PREFER the dashboard plan builder (https://payments.clocknext.com/plans) — it previews what a customer pays; use this tool as the fallback. This creates a real, sellable plan — get the pricing right before you create it.",
      update:
        "Replace a plan by id with a COMPLETE new definition (same shape as create — a full rewrite, not a patch; omitted fields are dropped). Changes the plan going forward; customers already on it keep their terms. Read it first with clocknext_get_plan, edit, then send the whole thing back.",
      archive:
        "Deactivate a plan in your catalogue (sets isActive→false) — ClockNext's soft archive, NOT a delete. The plan and its history are kept and customers already on it are unaffected; it simply becomes unsellable and drops out of active lists. Reversible: reactivate via clocknext_update_plan with isActive:true (a full rewrite) — there is no separate un-archive tool. Use ONLY to retire a plan you no longer sell. This does NOT delete anything and is unrelated to cancelling a customer's purchase or ending a subscription.",
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
    // Turn the `models` mixer into a model-grounded basePrice + pricePerCredit.
    priceInput: async (args) => {
      const a = args as {
        name: string;
        agentKey: string;
        models: MixerLine[];
        marginPercent: number;
        tokensPerCredit?: number;
        description?: string;
      };
      const priced = await computeMixerBase(cnk, a.models);
      if (!priced.ok) return { error: priced.error };
      return {
        name: a.name,
        agentKey: a.agentKey,
        basePrice: priced.basePrice,
        marginPercent: a.marginPercent,
        pricePerCredit: priced.basePrice * (1 + a.marginPercent / 100),
        tokensPerCredit: a.tokensPerCredit ?? 0,
        ...(a.description != null ? { description: a.description } : {}),
      };
    },
    desc: {
      list: "List the organisation's credit types (id, name, agentKey, price, active). Use it to find a credit id to reference from a plan's CREDIT component.",
      get: "Get one credit type in full by id — pricing, token mapping and active state.",
      create:
        "Create a credit type — a token-metered entitlement your product draws down against its `agentKey`. Pricing is MODEL-GROUNDED: give `models` (a mixer of enabled catalog model(s) + avg tokens + input/output/cache split) and a `marginPercent`; the tool reads live model prices and COMPUTES the base price + price-per-credit — you never hand-type a price, so a credit can't be mispriced or grounded in a disabled model. First-class alternative: create/price it in the dashboard (https://payments.clocknext.com/credits) — its live mixer preview is clearer and records the full per-model bundle; use this tool as the fallback (it stores the computed price only). A plan grants the credit via a CREDIT component referencing its id.",
      update:
        "Replace a credit by id with its COMPLETE new definition — a full rewrite, NOT a partial patch (omitted fields are cleared). Pricing is re-grounded from the `models` mixer you pass (same as create). To only flip active state, pass the current values plus isActive. Read the current credit with clocknext_get_credit first. Changing `agentKey` re-points which runtime signals map here — do it deliberately.",
      archive:
        "Deactivate a credit TYPE in your catalogue (sets isActive→false) — ClockNext's soft archive, NOT a delete. The credit and its history are kept; recorded usage and any plan already granting it keep working (update those plans with clocknext_update_plan to stop offering it). It simply can't be added to new plans and drops out of active lists. Reversible: reactivate via clocknext_update_credit with isActive:true (a full rewrite) — there is no separate un-archive tool. Use ONLY to retire a credit you no longer sell. This does NOT delete anything and is unrelated to archiving a customer, ending a purchase, or clearing a balance.",
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
    // Ground each step's price from its mixer; the outcome base is their sum.
    priceInput: async (args) => {
      const a = args as {
        name: string;
        description?: string | null;
        isActive?: boolean;
        marginPercent: number;
        steps: { name: string; agentKey: string; models: MixerLine[] }[];
      };
      const steps: { name: string; agentKey: string; basePrice: number }[] = [];
      let total = 0;
      for (const s of a.steps) {
        const priced = await computeMixerBase(cnk, s.models);
        if (!priced.ok) return { error: `Step "${s.name}": ${priced.error}` };
        if (priced.basePrice <= 0) {
          return {
            error: `Step "${s.name}" priced to $0 — give it real token usage, or model a fixed-cost/non-LLM event as a UNIT instead of an outcome step.`,
          };
        }
        steps.push({ name: s.name, agentKey: s.agentKey, basePrice: priced.basePrice });
        total += priced.basePrice;
      }
      return {
        name: a.name,
        ...(a.description != null ? { description: a.description } : {}),
        ...(a.isActive != null ? { isActive: a.isActive } : {}),
        basePrice: total,
        marginPercent: a.marginPercent,
        pricePerOutcome: total * (1 + a.marginPercent / 100),
        steps,
      };
    },
    desc: {
      list: "List the organisation's outcome types (id, name, price, active). Use it to find an outcome id to reference from a plan's OUTCOME component.",
      get: "Get one outcome type in full by id — its steps plus in-flight/completed stats.",
      create:
        "Create an outcome type — a multi-step LLM deliverable billed per COMPLETED outcome. Each of the 1–50 `steps` has its own `agentKey` and its own model mixer (`models`): the tool computes each step's base cost from live model prices, sums them, and applies `marginPercent`. Outcomes are for token-priced, multi-LLM-step deliverables; a fixed-cost / non-LLM event (e.g. an upload or export) belongs in a UNIT, not an outcome step. First-class alternative: build it in the dashboard (https://payments.clocknext.com/outcomes) — clearer per-step pricing preview; use this tool as the fallback. A plan grants it via an OUTCOME component referencing its id.",
      update:
        "Replace an outcome by id with its COMPLETE new definition — a full rewrite, NOT a partial patch (omitted steps/fields are dropped). Each step's price is re-grounded from its `models` mixer (same as create). Read the current outcome with clocknext_get_outcome first. Step agent keys are the runtime binding — change them deliberately.",
      archive:
        "Deactivate an outcome TYPE in your catalogue (sets isActive→false) — ClockNext's soft archive, NOT a delete. The outcome, its steps, and any in-flight or completed history are kept; existing plans and outcomes already in progress are unaffected. It simply can't be added to new plans and drops out of active lists. Reversible: reactivate via clocknext_update_outcome with isActive:true (a full rewrite) — there is no separate un-archive tool. Use ONLY to retire an outcome you no longer sell. This does NOT delete anything and is unrelated to archiving a customer or ending a purchase.",
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
        "Create a unit type: a metered usage unit reported against a lowercased stable `agentKey` (the key you send when recording unit usage) — its durable identity, unique org-wide. Units are for FIXED-COST / non-LLM events (an upload, an export, a seat) — one event = one unit, no tokens. Price it FLAT (a single `flatPrice` per event, default 0) or tiered — pricingType SLAB or VOLUME with `tiers` (1–50, ordered; only the last tier may have upTo:null). PREFER the dashboard (https://payments.clocknext.com/units) for the live price preview; use this tool as the fallback. A plan meters it via a UNIT component referencing this unit's id.",
      update:
        "Replace a unit by id with its COMPLETE new definition — a full rewrite, NOT a partial patch: any optional field you omit (description, tiers, flatPrice) is CLEARED, not left as-is. Read the current unit with clocknext_get_unit first, edit, then send the whole object back. Changing `agentKey` re-points which runtime signals map here — do it deliberately.",
      archive:
        "Deactivate a unit TYPE in your catalogue (sets isActive→false) — ClockNext's soft archive, NOT a delete. The unit and its recorded usage are kept; existing plans metering it keep working. It simply can't be added to new plans and drops out of active lists. Reversible: reactivate via clocknext_update_unit with isActive:true (a full rewrite) — there is no separate un-archive tool. Use ONLY to retire a unit you no longer sell. This does NOT delete anything and is unrelated to archiving a customer or ending a purchase.",
    },
  });
}
