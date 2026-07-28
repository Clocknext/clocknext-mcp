import { ClockNextError } from "@clocknext/sdk";

/** A successful tool result carrying a JSON payload as pretty text. */
export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** An error tool result — surfaces the message to the agent, flagged isError. */
export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

/** Turn any thrown value into a helpful one-line message for the agent. */
export function errMsg(err: unknown): string {
  if (err instanceof ClockNextError) {
    return `ClockNext API error${err.status ? ` (${err.status})` : ""}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
