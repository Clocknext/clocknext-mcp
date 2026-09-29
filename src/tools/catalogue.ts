import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ClockNextApi } from "../api";
import { errMsg, errorResult, jsonResult } from "./util";

/**
 * Operate-mode catalogue tools — CRUD (create / read / update / archive) over the
 * /api/v1 catalogue resources: plans, credits, outcomes, units. These MUTATE the
 * organisation's billing configuration, so they go through the MCP's own API
 * client (`src/api.ts`) rather than letting a model assemble raw API calls.
 *
 * Credit / outcome PRICING is model-grounded: the tool takes a `models` mixer
 * (enabled catalog model + avg tokens + input/output/cache split), reads the org's
 * live per-1M-token prices via list_models, and COMPUTES the base price + margin —
 * an agent can never hand-type an ungrounded price here. (The ClockNext product's mixer is
 * still the preferred, first-class way to price — it previews live and stores the
 * full per-model bundle; these tools are the fallback and store the computed price
 * only.)
 *
 * "Archive" maps to `setActive(id, false)` — a reversible deactivation, NOT a hard
 * delete (hard delete exists on the SDK but is intentionally not exposed here).
 */

// ---------- shared field schemas ----------

/** One line of a pricing mixer: an enabled catalog model + how many tokens it
 *  uses on average, split across input/output/cache as PERCENTAGES that total 100.
 *  The 100% rule is enforced here (refine) so a bad split is rejected at parse. */
const mixerLine = z
  .object({
    model: z
      .string()
      .min(1)
      .describe(
        "Enabled catalog model id from clocknext_list_models (e.g. 'gpt-4o'). Grounds the price in that model's live per-1M-token cost.",
      ),
    avgTokens: z
      .number()
      .positive()
      .describe("Average TOTAL tokens per credit / per step (input + output + cache combined)."),
    inputPct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("Percent of avgTokens that are input tokens (whole number)."),
    outputPct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("Percent that are output tokens (whole number)."),
    cachePct: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(0)
      .describe("Percent that are cache tokens (whole number). Default 0."),
  })
  .refine((l) => Math.round(l.inputPct + l.outputPct + (l.cachePct ?? 0)) === 100, {
    message: "inputPct + outputPct + cachePct must total 100.",
  });

type MixerLine = { model: string; avgTokens: number; inputPct: number; outputPct: number; cachePct?: number };

/**
 * One saved line of the ClockNext product's pricing calculator — the same shape
 * the product stores on a credit / outcome step as `modelBundle`. Sending it is
 * what makes the calculator show the chosen models, their average tokens and
 * the input / output / cache split when the credit is opened in the product.
 * Without it only the computed price is saved and the calculator opens empty.
 * `orgModelId` is the workspace's own model row id (`id` from GET /api/v1/models).
 */
type BundleEntry = {
  orgModelId: string;
  modelName: string;
  tokens: number;
  input: number;
  output: number;
  cache: number;
};

/** Total of every mixer line's average tokens — the calculator's token volume. */
function sumTokens(lines: readonly MixerLine[]): number {
  let total = 0;
  for (const line of lines) {
    total = total + line.avgTokens;
  }
  return Math.round(total);
}

/**
 * Compute a model-grounded base price (USD) from a mixer, using the org's LIVE
 * model prices. Rejects a model that isn't enabled/active or a split that doesn't
 * total 100, so a price can never be grounded in a disabled/unknown model.
 */
async function computeMixerBase(
  cnk: ClockNextApi,
  lines: readonly MixerLine[],
): Promise<
  | { ok: true; basePrice: number; bundle: BundleEntry[] | null }
  | { ok: false; error: string }
> {
  let models;
  try {
    models = await cnk.workspace.models({});
  } catch (err) {
    return { ok: false, error: `Could not load models to price against: ${errMsg(err)}` };
  }
  const byId = new Map(models.map((m) => [m.modelId.toLowerCase(), m]));

  let basePrice = 0;
  // Stays a list only while every model carries its row `id`. An older server
  // that doesn't return `id` still gets the credit priced — just without the
  // calculator breakdown (null), exactly as before.
  let bundle: BundleEntry[] | null = [];
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

    if (bundle !== null && typeof m.id === "string" && m.id.length > 0) {
      bundle.push({
        orgModelId: m.id,
        modelName: typeof m.modelName === "string" ? m.modelName : line.model,
        tokens: line.avgTokens,
        input: line.inputPct,
        output: line.outputPct,
        cache: cachePct,
      });
    } else {
      bundle = null;
    }
  }
  return { ok: true, basePrice, bundle };
}

// Plan component: flattened discriminated union. The per-type rules below are
// enforced by the server, not here — VERIFIED live: a missing/duplicated field is a
// 400 ValidationError ("Pick a credit.", "Enter a quantity for the composite.") and an
// id that resolves to nothing is a 404 NotFoundError. Both surface through errMsg with
// their status intact, so the field notes only have to guide the agent, not gate it.
const planComponent = z
  .object({
    type: z
      .enum(["WALLET", "FLAT", "CREDIT", "OUTCOME", "UNIT", "PRICING_METRIC"])
      .describe(
        "The meter type of this entitlement line. PRICING_METRIC is a COMPOSITE — the product word is 'composite' but the stored enum and the wire value are still the older name, so send PRICING_METRIC and expect it back.",
      ),
    billingMode: z
      .enum(["ADVANCE", "ARREAR"])
      .describe(
        "ADVANCE bills up-front for the cycle (needs amount/quantity); ARREAR meters and bills what was consumed.",
      ),
    amount: z
      .number()
      .optional()
      .describe(
        "WALLET or FLAT only, and REQUIRED for them (USD). WALLET = prepaid balance (plain wallet signals debit it at raw model cost — no margin; wallet-funded ARREAR usage debits it at customer price, margin included); FLAT = one-off fee.",
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
    pricingMetricId: z
      .string()
      .optional()
      .describe(
        "PRICING_METRIC only: id of an existing COMPOSITE (clocknext_list_composites). This component is the ONLY thing that makes a composite bill — the catalogue entry alone charges nobody.",
      ),
    quantity: z
      .number()
      .optional()
      .describe(
        "CREDIT/OUTCOME/UNIT/PRICING_METRIC only: the granted quantity — REQUIRED when billingMode is ADVANCE, omit when ARREAR (metered). For PRICING_METRIC + ADVANCE it is a prepaid POOL of composite-occurrence slots shared across the wrapped items: each distinct tag value claims one slot on completion, repeats reuse it, and once the pool is empty further occurrences are refused rather than billed.",
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
    .describe(
      "Billing cadence. EVERY_5_MIN is a TESTING-ONLY fast cadence (exercises the full invoice→payment→next-cycle loop in minutes, e.g. on sandbox) — never offer it for a real plan.",
    ),
  carryForward: z
    .boolean()
    .optional()
    .describe(
      "DEPRECATED — still accepted for back-compat but no longer read by the backend; setting it has no effect (carry-forward is fixed policy now: wallet money carries, allowances reset).",
    ),
  walletFundedArrear: z
    .boolean()
    .optional()
    .describe(
      "Wallet-funded metering. Default false. When true, every metered (ARREAR) CREDIT/OUTCOME/UNIT component is paid FROM the customer's prepaid WALLET as usage happens — one invoice per cycle — instead of a separate arrear invoice at cycle end. The wallet may go negative mid-cycle; the next cycle's wallet top-up absorbs the overdraft. Backend rejects (422) unless ALL THREE hold: (1) the plan has at least one ARREAR credit/outcome/unit component; (2) the plan has a WALLET component; (3) that WALLET component is billingMode ADVANCE (a metered/ARREAR wallet is refused as double-billing). Margin is PRESERVED: wallet-funded ARREAR usage debits the wallet at the CUSTOMER price (margin included) — only plain type:'wallet' signals debit at raw model cost with no margin.",
    ),
  priceAdjustment: z
    .number()
    .optional()
    .describe(
      "Signed rounding nudge (USD) on the plan's computed due-at-purchase price — negative discounts, positive adds (e.g. -0.01 to land on a round number). Default 0; coerced to 0 for FREE / all-ARREAR plans that have no advance total to round. Leave unset unless you need to tidy a rounding edge.",
    ),
  currencyCode: z.string().optional().describe("ISO 4217 (3 letters). Default USD."),
  isActive: z.boolean().optional().describe("Whether the plan is active/sellable."),
  components: z
    .array(planComponent)
    .min(1)
    .describe(
      "At least one entitlement line. CREDIT/OUTCOME/UNIT components reference an existing resource by id, and PRICING_METRIC references an existing composite by pricingMetricId — create those first.",
    ),
};

const creditInput: z.ZodRawShape = {
  name: z.string().min(1).describe("Credit name."),
  agentKey: z
    .string()
    .min(1)
    .describe(
      "Lowercased stable key you report credit usage against (sent as `agentKey` when recording usage). The credit's durable identity — chars [a-z0-9._-]; a rename never changes it.",
    ),
  models: z
    .array(mixerLine)
    .min(1)
    .describe(
      "Model mixer that GROUNDS the price — one or more enabled catalog models with avg tokens + input/output/cache split. The tool reads live prices and computes the base cost; never type a raw price.",
    ),
  marginPercent: z
    .number()
    .min(0)
    .describe("Markup over the computed base cost, as a percent (100 = double the base = pricePerCredit)."),
  tokensPerCredit: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Display-only metadata: the token volume of the pricing bundle shown in the ClockNext product. Does NOT affect draw-down — credits consumed per signal = provider cost / basePrice. Default 0.",
    ),
  description: z.string().optional().describe("Optional human-readable description."),
};

const outcomeStep = z.object({
  name: z.string().min(1).describe("Step name (unique within the outcome)."),
  agentKey: z
    .string()
    .min(1)
    .describe(
      "Lowercased stable key you report this outcome step against (sent as `agentKey` when recording usage). Chars [a-z0-9._-].",
    ),
  models: z
    .array(mixerLine)
    .min(1)
    .describe(
      "Model mixer grounding THIS step's price. Every outcome step is an LLM step — a non-LLM, fixed-cost event is a UNIT, not an outcome step.",
    ),
});

const outcomeInput: z.ZodRawShape = {
  name: z.string().min(1).describe("Outcome name."),
  agentKey: z
    .string()
    .min(1)
    .describe(
      "The OUTCOME's own stable key — REQUIRED, unique org-wide, chars [a-z0-9._-]. Distinct from a step's agentKey and in a separate namespace: usage is still reported against a STEP's key, never this one. This identifies the outcome itself (mirrors a credit's agentKey); a rename never changes it.",
    ),
  description: z.string().nullish().describe("Optional human-readable description."),
  isActive: z.boolean().optional().describe("Whether the outcome is active/sellable."),
  marginPercent: z
    .number()
    .min(0)
    .describe("Markup over the summed step base costs, as a percent (100 = double = pricePerOutcome)."),
  steps: z
    .array(outcomeStep)
    .min(1)
    .max(50)
    .describe("1–50 steps, each grounded by its own model mixer. Step names and agent keys must each be unique."),
};

const unitInput: z.ZodRawShape = {
  name: z.string().min(1).describe("Unit name."),
  agentKey: z
    .string()
    .min(1)
    .describe(
      "Lowercased stable key consumption is reported against (sent as `agentKey` when recording unit usage). The unit's durable identity — unique org-wide, chars [a-z0-9._-]; a rename never changes it.",
    ),
  pricingType: z
    .enum(["FLAT", "SLAB", "VOLUME"])
    .describe("FLAT = a single per-event price. SLAB/VOLUME = tiered pricing."),
  flatPrice: z.number().min(0).optional().describe("FLAT only: price per event. Default 0."),
  tiers: z
    .array(unitTier)
    .min(1)
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
    /** Whether this resource's full-edit endpoint actually honours `isActive`.
     *  VERIFIED against the live API, and it is NOT uniform: plan / outcome /
     *  unit updates DO flip active state, credit updates do not (the backend's
     *  credit schema has no isActive, so `creditInput` omits it too). The
     *  archive/unarchive descriptions below are generated from this, so they
     *  can't drift back into claiming a blanket rule that isn't true. */
    updateHonoursIsActive: boolean;
    api: Api;
    input: z.ZodRawShape;
    desc: { list: string; get: string; create: string; update: string; archive: string };
    priceInput?: PriceInput;
  },
): void {
  const { resource, plural, api, input, desc, priceInput, updateHonoursIsActive } = opts;

  server.registerTool(
    `clocknext_list_${plural}`,
    {
      title: `ClockNext: list ${plural}`,
      description: desc.list,
      inputSchema: {
        active: z
          .boolean()
          .optional()
          .describe(
            `Filter by active state: true = only active ${plural}, false = only archived ${plural}, omit = all.`,
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ active }) => {
      try {
        const rows = await api.list(active === undefined ? {} : { active });
        // The API only special-cases `active=true`; `active=false` comes back
        // unfiltered. Filter here so the documented contract holds both ways
        // (a no-op for `true`, which the backend already narrowed).
        const filtered =
          active === undefined || !Array.isArray(rows)
            ? rows
            : (rows as { isActive?: boolean }[]).filter((r) => r.isActive === active);
        return jsonResult({
          count: Array.isArray(filtered) ? filtered.length : undefined,
          [plural]: filtered,
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

  // The bare active toggle is the explicit reactivation path. Whether the
  // full edit ALSO flips isActive differs per resource (see
  // `updateHonoursIsActive`), so the wording below is generated, not asserted.
  server.registerTool(
    `clocknext_unarchive_${resource}`,
    {
      title: `ClockNext: unarchive ${resource}`,
      description: [
        `Reactivate an archived ${resource} (sets isActive→true) — the reverse of clocknext_archive_${resource}. Same identity, same definition; nothing is re-priced or rewritten.`,
        "",
        "Rules:",
        updateHonoursIsActive
          ? `- Prefer this over clocknext_update_${resource}: that full edit CAN also set isActive, but it rewrites the whole ${resource} at the same time. This tool changes active state and nothing else.`
          : `- This is the ONLY way to reactivate via the MCP — clocknext_update_${resource} has no isActive field, so a full edit cannot flip active state.`,
        `- Prefer this over creating a replacement: agentKeys/identities are unique org-wide, so a parked ${resource} must be revived, never duplicated.`,
      ].join("\n"),
      inputSchema: { id: z.string().describe(`The ${resource} id to reactivate.`) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      try {
        const res = await api.setActive(id, true);
        return jsonResult(res ?? { ok: true, unarchived: id });
      } catch (err) {
        return errorResult(errMsg(err));
      }
    },
  );
}

// ---------- wire the four resources ----------

export function registerCatalogueTools(server: McpServer, cnk: ClockNextApi): void {
  registerCrud(server, {
    resource: "plan",
    plural: "plans",
    updateHonoursIsActive: true,
    api: {
      list: (p) => cnk.plans.list(p),
      get: (id) => cnk.plans.get(id),
      create: (i) => cnk.plans.create(i as never),
      update: (id, i) => cnk.plans.update(id, i as never),
      setActive: (id, a) => cnk.plans.setActive(id, a),
    },
    input: planInput,
    desc: {
      list: "List the organisation's billing plans (id, name, billing cycle, price, active). Find a plan id, or see what's on offer. Pass active=true for only sellable plans, active=false for only archived ones.",
      get: "Get one plan in full by id — its entitlement components (wallet/credit/outcome/unit/flat/composite), billing cycle, currency and active state. A composite component reads back as type PRICING_METRIC with its pricingMetricId, so a read→edit→update round-trip keeps it.",
      create: [
        "Create a billing plan bundling one or more entitlement `components`: WALLET (prepaid USD balance, debited at raw model cost — no margin), FLAT (one-off fee), CREDIT/OUTCOME/UNIT entitlements referencing an existing resource by id, or PRICING_METRIC referencing an existing COMPOSITE by pricingMetricId.",
        "",
        "Rules:",
        "- Create referenced credits/outcomes/units first (clocknext_create_credit / _outcome / _unit), then pass their ids.",
        "- To SELL a composite, add a PRICING_METRIC component with the composite's id as pricingMetricId (clocknext_list_composites). This is the only thing that makes a composite bill — the catalogue entry alone charges nobody, errors nowhere, and looks configured. ADVANCE needs a quantity: a prepaid POOL of occurrence slots shared across the wrapped items.",
        "- Each component's billingMode is ADVANCE (up-front, needs amount/quantity) or ARREAR (metered).",
        "- Set walletFundedArrear:true to pay metered (ARREAR) usage from the plan's prepaid WALLET as it happens (one invoice/cycle, wallet may go negative) instead of a separate cycle-end arrear invoice. Requires >=1 ARREAR credit/outcome/unit AND an ADVANCE WALLET component, or the backend rejects it (422).",
        "- FREE plans must be ADVANCE-only with no FLAT component.",
        "- Creates a real, sellable plan — get pricing right first. Prefer the plan builder in the ClockNext product (https://payments.clocknext.com/plans); this is the fallback.",
      ].join("\n"),
      update: [
        "Replace a plan by id with a COMPLETE new definition (same shape as create).",
        "",
        "Rules:",
        "- Full rewrite, not a patch — omitted fields are dropped. Read it first with clocknext_get_plan, edit, then send the whole thing back. Re-send every component you want to keep, PRICING_METRIC (composite) lines included — dropping one unsells that composite.",
        "- Components are replaced, not edited in place: every component gets a NEW id on each update, even ones you sent back unchanged. Never store a component id as a durable handle.",
        "- walletFundedArrear is part of that full definition — re-send it (with the ADVANCE WALLET + ARREAR components it requires) or it reverts to false. carryForward is deprecated and ignored.",
        "- Changes apply going forward; customers already on the plan keep their terms.",
      ].join("\n"),
      archive: [
        "Deactivate a plan (sets isActive→false) — ClockNext's soft archive, NOT a delete.",
        "",
        "Rules:",
        "- History is kept and customers already on it are unaffected; it just becomes unsellable and drops out of active lists.",
        "- Reversible: reactivate with clocknext_unarchive_plan. clocknext_update_plan can also set isActive, but it rewrites the entire plan — use unarchive when all you want is to switch it back on.",
        "- Unrelated to cancelling a customer's purchase or ending a subscription.",
      ].join("\n"),
    },
  });

  registerCrud(server, {
    resource: "credit",
    plural: "credits",
    updateHonoursIsActive: false,
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
      if (priced.basePrice <= 0) {
        return {
          error:
            "Credit priced to $0 — the mixer's model(s) have no catalog price, so usage would meter at zero revenue. Set their pricing on the Models page first, then retry.",
        };
      }
      return {
        name: a.name,
        agentKey: a.agentKey,
        basePrice: priced.basePrice,
        marginPercent: a.marginPercent,
        pricePerCredit: priced.basePrice * (1 + a.marginPercent / 100),
        // Same as the product's calculator: the credit's token volume is the
        // sum of every model line's average tokens, unless the caller set one.
        tokensPerCredit: a.tokensPerCredit ?? sumTokens(a.models),
        ...(priced.bundle !== null ? { modelBundle: priced.bundle } : {}),
        ...(a.description != null ? { description: a.description } : {}),
      };
    },
    desc: {
      list: "List the organisation's credit types (id, name, agentKey, price, active). Find a credit id to reference from a plan's CREDIT component.",
      get: "Get one credit type in full by id — pricing, token mapping and active state.",
      create: [
        "Create a credit — a token-metered entitlement your product draws down against its `agentKey`.",
        "",
        "Rules:",
        "- Price is model-grounded: give the `models` mixer + `marginPercent`; the tool reads live model prices and computes the base price + price-per-credit. Never hand-typed.",
        "- Enable the models you price against first (clocknext_add_model / _list_models).",
        "- Prefer the credits builder in the ClockNext product (https://payments.clocknext.com/credits) — its live preview shows the price as you build it. This tool saves the same per-model mix (models, average tokens, input/output/cache split), so the credit opens with its calculator filled in.",
        "- A plan grants the credit via a CREDIT component referencing its id.",
      ].join("\n"),
      update: [
        "Replace a credit by id with its COMPLETE new definition.",
        "",
        "Rules:",
        "- Full rewrite, not a patch — omitted fields are cleared. Read it first with clocknext_get_credit.",
        "- Pricing is re-grounded from the `models` mixer you pass (same as create). This tool has NO isActive field — to change active state use clocknext_archive_credit / clocknext_unarchive_credit.",
        "- Changing `agentKey` re-points which runtime signals map here — do it deliberately.",
      ].join("\n"),
      archive: [
        "Deactivate a credit TYPE (sets isActive→false) — ClockNext's soft archive, NOT a delete.",
        "",
        "Rules:",
        "- Recorded usage and any plan already granting it keep working (update those plans with clocknext_update_plan to stop offering it); it just can't be added to new plans and drops out of active lists.",
        "- Reversible: reactivate with clocknext_unarchive_credit — the ONLY way, since clocknext_update_credit has no isActive field (unlike plans/outcomes/units).",
        "- Unrelated to archiving a customer, ending a purchase, or clearing a balance.",
      ].join("\n"),
    },
  });

  registerCrud(server, {
    resource: "outcome",
    plural: "outcomes",
    updateHonoursIsActive: true,
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
        agentKey: string;
        description?: string | null;
        isActive?: boolean;
        marginPercent: number;
        steps: { name: string; agentKey: string; models: MixerLine[] }[];
      };
      const steps: {
        name: string;
        agentKey: string;
        basePrice: number;
        modelBundle?: BundleEntry[];
      }[] = [];
      let total = 0;
      for (const s of a.steps) {
        const priced = await computeMixerBase(cnk, s.models);
        if (!priced.ok) return { error: `Step "${s.name}": ${priced.error}` };
        if (priced.basePrice <= 0) {
          return {
            error: `Step "${s.name}" priced to $0 — give it real token usage, or model a fixed-cost/non-LLM event as a UNIT instead of an outcome step.`,
          };
        }
        steps.push({
          name: s.name,
          agentKey: s.agentKey,
          basePrice: priced.basePrice,
          ...(priced.bundle !== null ? { modelBundle: priced.bundle } : {}),
        });
        total += priced.basePrice;
      }
      return {
        name: a.name,
        // Required by POST/PATCH /api/v1/outcomes — the outcome's own org-wide
        // key, separate from the step keys ingest resolves against.
        agentKey: a.agentKey,
        ...(a.description != null ? { description: a.description } : {}),
        ...(a.isActive != null ? { isActive: a.isActive } : {}),
        basePrice: total,
        marginPercent: a.marginPercent,
        pricePerOutcome: total * (1 + a.marginPercent / 100),
        steps,
      };
    },
    desc: {
      list: "List the organisation's outcome types (id, name, price, active). Find an outcome id to reference from a plan's OUTCOME component.",
      get: "Get one outcome type in full by id — its steps plus in-flight/completed stats.",
      create: [
        "Create an outcome — a multi-step LLM deliverable billed per COMPLETED outcome. Each of the 1–50 `steps` has its own `agentKey` and model mixer.",
        "",
        "Rules:",
        "- TWO kinds of agent key, both required and both unique org-wide, in separate namespaces: the outcome's own top-level `agentKey` (its identity), and each step's `agentKey` (what usage is reported against). Never reuse one as the other.",
        "- Price is model-grounded: each step's base cost is computed from live model prices, summed, then `marginPercent` applied. Never hand-typed.",
        "- Every step is an LLM step. A fixed-cost / non-LLM event (an upload, an export) is a UNIT, not an outcome step.",
        "- Prefer the outcomes builder in the ClockNext product (https://payments.clocknext.com/outcomes); this is the fallback.",
        "- A plan grants it via an OUTCOME component referencing its id.",
      ].join("\n"),
      update: [
        "Replace an outcome by id with its COMPLETE new definition.",
        "",
        "Rules:",
        "- Full rewrite, not a patch — omitted steps/fields are dropped. Read it first with clocknext_get_outcome.",
        "- The outcome's own `agentKey` is REQUIRED here too — pass back the existing one (clocknext_get_outcome returns it) unless you deliberately mean to change the outcome's identity.",
        "- Each step's price is re-grounded from its `models` mixer (same as create).",
        "- Step agent keys are the runtime binding — change them deliberately.",
      ].join("\n"),
      archive: [
        "Deactivate an outcome TYPE (sets isActive→false) — ClockNext's soft archive, NOT a delete.",
        "",
        "Rules:",
        "- Steps and any in-flight/completed history are kept; existing plans and in-progress outcomes are unaffected; it just can't be added to new plans and drops out of active lists.",
        "- Reversible: reactivate with clocknext_unarchive_outcome. clocknext_update_outcome can also set isActive, but it rewrites the whole outcome (steps included) — use unarchive when all you want is to switch it back on.",
        "- Unrelated to archiving a customer or ending a purchase.",
      ].join("\n"),
    },
  });

  registerCrud(server, {
    resource: "unit",
    plural: "units",
    updateHonoursIsActive: true,
    api: {
      list: (p) => cnk.units.list(p),
      get: (id) => cnk.units.get(id),
      create: (i) => cnk.units.create(i as never),
      update: (id, i) => cnk.units.update(id, i as never),
      setActive: (id, a) => cnk.units.setActive(id, a),
    },
    input: unitInput,
    desc: {
      list: "List the organisation's unit types (id, name, pricing type, active). Find a unit id to reference from a plan's UNIT component.",
      get: "Get one unit type in full by id — pricing type, flat price or tiers, plus usage stats.",
      create: [
        "Create a unit — a metered usage unit for FIXED-COST / non-LLM events (an upload, an export, a seat): one event = one unit, no tokens.",
        "",
        "Rules:",
        "- Price it FLAT (single `flatPrice` per event, default 0) or tiered (pricingType SLAB or VOLUME with `tiers`).",
        "- Reported against a lowercased stable `agentKey` — its durable identity, unique org-wide.",
        "- Prefer the units builder in the ClockNext product (https://payments.clocknext.com/units); this is the fallback.",
        "- A plan meters it via a UNIT component referencing its id.",
      ].join("\n"),
      update: [
        "Replace a unit by id with its COMPLETE new definition.",
        "",
        "Rules:",
        "- Full rewrite, not a patch — omitted optional fields (description, tiers, flatPrice) are CLEARED. Read it first with clocknext_get_unit.",
        "- Changing `agentKey` re-points which runtime signals map here — do it deliberately.",
      ].join("\n"),
      archive: [
        "Deactivate a unit TYPE (sets isActive→false) — ClockNext's soft archive, NOT a delete.",
        "",
        "Rules:",
        "- Recorded usage is kept and existing plans metering it keep working; it just can't be added to new plans and drops out of active lists.",
        "- Reversible: reactivate with clocknext_unarchive_unit. clocknext_update_unit can also set isActive, but it rewrites the whole unit — use unarchive when all you want is to switch it back on.",
        "- Unrelated to archiving a customer or ending a purchase.",
      ].join("\n"),
    },
  });
}
