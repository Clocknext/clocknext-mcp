import { z } from "zod";
import type { Signal } from "@clocknext/sdk";

/**
 * The shared zod input shape for a usage signal, used by both the verify and
 * record tools. Kept flat (a ZodRawShape) as MCP tool inputs must be — the
 * per-type requirement (agentKey for credit/outcome) is enforced in `buildSignal`.
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
  complete: z
    .boolean()
    .optional()
    .describe(
      "Outcome only: set true on the LAST step's signal to declare the run finished — that is what bills the outcome (completion is declared by you, never inferred from step counts). Replaying a completed run bills nothing.",
    ),
};

/** Args after zod parsing (plus the record-only idempotencyKey). */
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
  idempotencyKey?: string;
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
    ...(a.idempotencyKey ? { idempotencyKey: a.idempotencyKey } : {}),
  };
  if (a.type === "wallet") return { type: "wallet", ...common };
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
      agentKey: a.agentKey,
      runId: a.runId,
      ...(a.complete != null ? { complete: a.complete } : {}),
    };
  }
  return { type: a.type, ...common, agentKey: a.agentKey };
}
