import { describe, it, expect } from "vitest";
import { tools } from "./tools.js";
import {
  WRITE_TOOLS,
  isWriteTool,
  isWriteEnabled,
  filterTools,
  assertWriteAllowed,
  WRITE_DISABLED_MESSAGE,
} from "./writeGate.js";

/**
 * Read-only tools. Every registered tool must be classified either here or in
 * WRITE_TOOLS — an unclassified tool fails the shape test below, so a future
 * mutating tool cannot land ungated.
 *
 * ga4_send_feedback / ga4_suggest_improvement write only to local log files
 * (saveFeedback/saveImprovement), never to GA4 remote state — classified read.
 */
const READ_TOOLS = [
  "ga4_get_client_context",
  "ga4_run_report",
  "ga4_realtime_report",
  "ga4_list_custom_dimensions",
  "ga4_list_custom_metrics",
  "ga4_list_data_streams",
  "ga4_send_feedback",
  "ga4_suggest_improvement",
];

/** Name fragments that mark a tool as mutating. */
const MUTATING_NAME_PATTERN = /create_|update_|delete_|publish_/;

describe("writeGate", () => {
  describe("shape: tool classification covers every registered tool", () => {
    it("every registered tool whose name matches the mutating pattern is in WRITE_TOOLS", () => {
      const ungated = tools
        .map((t) => t.name)
        .filter((n) => MUTATING_NAME_PATTERN.test(n) && !WRITE_TOOLS.has(n));
      expect(ungated).toEqual([]);
    });

    it("WRITE_TOOLS is a subset of the registered tool names", () => {
      const registered = new Set(tools.map((t) => t.name));
      const phantom = [...WRITE_TOOLS].filter((n) => !registered.has(n));
      expect(phantom).toEqual([]);
    });

    it("every registered tool is classified as either read or write", () => {
      const classified = new Set<string>([...WRITE_TOOLS, ...READ_TOOLS]);
      const uncovered = tools.map((t) => t.name).filter((n) => !classified.has(n));
      expect(uncovered).toEqual([]);
    });

    it("WRITE_TOOLS and READ_TOOLS do not overlap", () => {
      const overlap = READ_TOOLS.filter((n) => WRITE_TOOLS.has(n));
      expect(overlap).toEqual([]);
    });

    it("gates the 1 known mutating tool", () => {
      expect([...WRITE_TOOLS].sort()).toEqual(["ga4_create_custom_dimension"]);
    });
  });

  describe("read-only default (env unset)", () => {
    it("assertWriteAllowed throws for ga4_create_custom_dimension", () => {
      expect(() => assertWriteAllowed("ga4_create_custom_dimension", {})).toThrow(
        /write operation/i,
      );
    });

    it("assertWriteAllowed blocks every write tool", () => {
      for (const w of WRITE_TOOLS) {
        expect(() => assertWriteAllowed(w, {})).toThrow(/write operation/i);
      }
    });

    it("filterTools excludes every write tool", () => {
      const names = filterTools(tools, {}).map((t) => t.name);
      for (const w of WRITE_TOOLS) {
        expect(names).not.toContain(w);
      }
    });

    it("filterTools keeps every read tool", () => {
      const names = filterTools(tools, {}).map((t) => t.name);
      for (const r of READ_TOOLS) {
        expect(names).toContain(r);
      }
    });

    it("assertWriteAllowed permits read tools", () => {
      for (const r of READ_TOOLS) {
        expect(() => assertWriteAllowed(r, {})).not.toThrow();
      }
    });

    it("error message names the env var fix", () => {
      try {
        assertWriteAllowed("ga4_create_custom_dimension", {});
      } catch (err) {
        expect((err as Error).message).toContain("GA4_MCP_WRITE=true");
        return;
      }
      throw new Error("expected assertWriteAllowed to throw");
    });
  });

  describe("writes enabled (GA4_MCP_WRITE=true)", () => {
    const env = { GA4_MCP_WRITE: "true" };

    it("assertWriteAllowed permits write tools", () => {
      for (const w of WRITE_TOOLS) {
        expect(() => assertWriteAllowed(w, env)).not.toThrow();
      }
    });

    it("filterTools lists every registered tool", () => {
      expect(filterTools(tools, env).map((t) => t.name).sort()).toEqual(
        tools.map((t) => t.name).sort(),
      );
    });

    it("isWriteEnabled accepts true/1/yes case-insensitively", () => {
      expect(isWriteEnabled({ GA4_MCP_WRITE: "true" })).toBe(true);
      expect(isWriteEnabled({ GA4_MCP_WRITE: "TRUE" })).toBe(true);
      expect(isWriteEnabled({ GA4_MCP_WRITE: "1" })).toBe(true);
      expect(isWriteEnabled({ GA4_MCP_WRITE: "yes" })).toBe(true);
    });
  });

  describe("anchor: fail-closed on non-affirmative env values", () => {
    const badValues = ["false", "", "0", "no", "garbage", "enable", "on"];

    for (const v of badValues) {
      it(`refuses writes when GA4_MCP_WRITE=${JSON.stringify(v)}`, () => {
        const env = { GA4_MCP_WRITE: v };
        expect(isWriteEnabled(env)).toBe(false);
        expect(() =>
          assertWriteAllowed("ga4_create_custom_dimension", env),
        ).toThrow(/write operation/i);
        const names = filterTools(tools, env).map((t) => t.name);
        expect(names).not.toContain("ga4_create_custom_dimension");
      });
    }
  });

  describe("isWriteTool", () => {
    it("classifies write vs read tools", () => {
      expect(isWriteTool("ga4_create_custom_dimension")).toBe(true);
      expect(isWriteTool("ga4_run_report")).toBe(false);
      expect(isWriteTool("ga4_list_custom_dimensions")).toBe(false);
    });
  });

  it("WRITE_DISABLED_MESSAGE mentions the env var", () => {
    expect(WRITE_DISABLED_MESSAGE).toContain("GA4_MCP_WRITE=true");
  });
});
