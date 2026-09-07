import { z } from "zod";
import type { Signal } from "@clocknext/sdk";

/**
 * The zod input shape for a usage signal, used by `clocknext_verify_signal`.
 * Kept flat (a ZodRawShape) as MCP tool inputs must be — the per-type
 * requirement (agentKey for credit/outcome) is enforced in `buildSignal`.
 *
 * There is deliberately NO record/track counterpart: the MCP prices signals but
 * never bills. Real signals are fired by the product's own code via
 * `@clocknext/sdk` (`signals.credit/wallet/outcome`), which is also the only way
 * to prove the integration end-to-end.
 */
export const signalShape = {
  type: z
    .enum(["wallet", "credit", "outcome"])
    .describe(
      "Which meter to record against: 'wallet' debits USD at the model's cost; 'credit' draws down a named credit; 'outcome' advances one step of a run (set complete:true on the last step to bill it).",
    ),
  customerId: z
    .string()
    .min(1)
    .describe("The ClockNext customer id (e.g. cus_…) this usage belongs to."),
  model: z
    .string()
    .min(1)
    .describe(
      "Catalog model id (e.g. 'gpt-4o'), matched case-insensitively. Use clocknext_list_models to see valid ids.",
    ),
  inputTokens: z.number().int().min(0).describe("Prompt tokens for this call."),
  outputTokens: z.number().int().min(0).describe("Completion tokens for this call."),
  cacheTokens: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Cached (prompt-cache) tokens; defaults to 0 when omitted."),
  agentKey: z
    .string()
    .optional()
    .describe(
      "Required for type 'credit' (the credit's agent key) or 'outcome' (the outcome step's agent key). Ignored for 'wallet'.",
    ),
  member: z
    .string()
    .optional()
    .describe("Optional customer-member email to attribute the usage to."),
  runId: z
    .string()
    .optional()
    .describe(
      "REQUIRED for type 'outcome' (ignored otherwise): your stable id for ONE deliverable run, unique per organisation. Every step signal of the same run sends the same runId.",
    ),
  compositeRef: z
    .string()
    .optional()
    .describe(
      "Optional: the refId of a composite this signal belongs to (see clocknext_list_composites). A composite bundles several credits/outcomes/units and is billed as ONE thing when a plan sells it. Requires compositeValue too — send neither or both.",
    ),
  compositeValue: z
    .string()
    .optional()
    .describe(
      "Optional: your correlation id for ONE occurrence of the composite (a session, a call, a job). Every signal sharing this value belongs to the same occurrence. Requires compositeRef too.",
    ),
  complete: z
    .boolean()
    .optional()
    .describe(
      "Outcome only: set true on the LAST step's signal to declare the run finished — that is what bills the outcome (completion is declared by you, never inferred from step counts). Replaying a completed run bills nothing. NOTE: on a dry run this flag changes nothing you can observe — a dry run opens and closes no run, so it always reports closedRun:false and prices only THIS step's tokens, never the outcome's pricePerOutcome. Use it to confirm the step key and customer resolve; read pricePerOutcome from clocknext_get_outcome for the completion charge.",
    ),
};

/** Args after zod parsing. */
export interface SignalArgs {
  type: "wallet" | "credit" | "outcome";
  customerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  agentKey?: string;
  member?: string;
  runId?: string;
  complete?: boolean;
  compositeRef?: string;
  compositeValue?: string;
}

/** Map tool args to an SDK `Signal`, or return a validation error message. */
export function buildSignal(a: SignalArgs): Signal | { error: string } {
  const tokens = {
    input: a.inputTokens,
    output: a.outputTokens,
    ...(a.cacheTokens != null ? { cache: a.cacheTokens } : {}),
  };
  const common = {
    customerId: a.customerId,
    model: a.model,
    tokens,
    ...(a.member ? { member: a.member } : {}),
  };

  // The tag is one thing in two arguments, because an MCP tool's input has to
  // be flat. Half of it is always a mistake, and a SILENT one — the SDK would
  // simply not send the tag, and a dry run that ignored the composite reads
  // exactly like one that honoured it. So it is refused rather than dropped.
  if (Boolean(a.compositeRef) !== Boolean(a.compositeValue)) {
    return {
      error:
        "compositeRef and compositeValue go together — send both (the composite's refId and your correlation value for one occurrence) or neither.",
    };
  }
  const composite =
    a.compositeRef && a.compositeValue
      ? { composite: { ref: a.compositeRef, value: a.compositeValue } }
      : {};

  // A wallet signal takes no composite: composites group entitlement traffic,
  // and raw wallet spend is not entitlement traffic. The server accepts and
  // IGNORES one, so passing it here would imply a rollup that never exists.
  if (a.type === "wallet") {
    if (a.compositeRef) {
      return {
        error:
          "A wallet signal cannot belong to a composite — composites group entitlement traffic, and wallet spend is metered as money. Drop compositeRef/compositeValue, or meter this against a credit instead.",
      };
    }
    return { type: "wallet", ...common };
  }
  if (!a.agentKey) {
    return { error: `agentKey is required for a '${a.type}' signal.` };
  }
  if (a.type === "outcome") {
    if (!a.runId) {
      return { error: "runId is required for an 'outcome' signal — it groups the step signals of one deliverable run." };
    }
    return {
      type: "outcome",
      ...common,
      ...composite,
      agentKey: a.agentKey,
      runId: a.runId,
      ...(a.complete != null ? { complete: a.complete } : {}),
    };
  }
  return { type: a.type, ...common, ...composite, agentKey: a.agentKey };
}
