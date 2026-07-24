import { createWriteGate } from "mcp-write-gate";

/**
 * Tools that mutate GA4 state. These are hidden from the tool list and
 * refused at call time unless GA4_MCP_WRITE=true.
 *
 * ga4_send_feedback / ga4_suggest_improvement only append to local log files
 * — they never touch GA4 remote state — so they stay ungated.
 *
 * Adding a new tool? Put it in this set if it creates, updates, deletes, or
 * publishes anything in GA4. The shape test in writeGate.test.ts enforces
 * this by name pattern.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "ga4_create_custom_dimension",
]);

const gate = createWriteGate({
  writeTools: WRITE_TOOLS,
  envPrefix: "GA4",
});

export function isWriteTool(name: string): boolean {
  return gate.isWriteTool(name);
}

export function isWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return gate.isWriteEnabled(env);
}

export function filterTools<T extends { name: string }>(
  allTools: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  return gate.filterTools(allTools, env);
}

export const WRITE_DISABLED_MESSAGE =
  "Write operations are disabled. Set GA4_MCP_WRITE=true in the MCP server environment " +
  "to enable mutating tools (create custom dimensions).";

/**
 * Assert that a tool call is allowed under the current write-mode setting.
 * Throws a clear Error if the tool mutates state and writes are disabled.
 */
export function assertWriteAllowed(
  toolName: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    gate.assertWriteAllowed(toolName, env);
  } catch {
    throw new Error(
      `Tool "${toolName}" is a write operation. ${WRITE_DISABLED_MESSAGE}`,
    );
  }
}
