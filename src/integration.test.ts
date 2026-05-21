import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LIVE = process.env.LIVE_TEST === "true";
const PROPERTY_ID = process.env.TEST_GA4_PROPERTY_ID || "331956119";

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
}

describe.skipIf(!LIVE)("mcp-ga4 integration", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bash",
      args: ["-c", "source ./run-mcp.sh"],
      cwd: "/Users/mark/claude-code/mcps/mcp-ga4",
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists tools and finds expected tool names", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("ga4_get_client_context");
    expect(names).toContain("ga4_run_report");
    expect(names).toContain("ga4_realtime_report");
    expect(names).toContain("ga4_list_data_streams");
    expect(names.length).toBeGreaterThanOrEqual(7);
  });

  it("ga4_get_client_context returns property info", async () => {
    const result = await client.callTool({
      name: "ga4_get_client_context",
      arguments: { working_directory: "/Users/mark/claude-code/clients/flowspace" },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    // Discovery tool: returns either a specific property_id or a list of available clients.
    expect(data.property_id ?? data.available_clients).toBeDefined();
  }, 15_000);

  it("ga4_run_report with dimensions=date, metrics=sessions", async () => {
    const result = await client.callTool({
      name: "ga4_run_report",
      arguments: {
        property_id: PROPERTY_ID,
        dimensions: "date",
        metrics: "sessions",
        start_date: "7daysAgo",
        end_date: "today",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.row_count).toBeGreaterThanOrEqual(0);
    expect(data.date_range).toBeDefined();
    if (data.rows.length > 0) {
      expect(data.rows[0]).toHaveProperty("date");
      expect(data.rows[0]).toHaveProperty("sessions");
    }
  }, 15_000);

  it("ga4_realtime_report returns rows", async () => {
    const result = await client.callTool({
      name: "ga4_realtime_report",
      arguments: {
        property_id: PROPERTY_ID,
        dimensions: "eventName",
        metrics: "eventCount",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    expect(Array.isArray(data.rows)).toBe(true);
    expect(data.row_count).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("ga4_list_data_streams returns streams", async () => {
    const result = await client.callTool({
      name: "ga4_list_data_streams",
      arguments: { property_id: PROPERTY_ID },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    expect(Array.isArray(data.data_streams)).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("ga4_list_custom_dimensions returns dimensions", async () => {
    const result = await client.callTool({
      name: "ga4_list_custom_dimensions",
      arguments: { property_id: PROPERTY_ID },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error).toBeUndefined();
    expect(Array.isArray(data.custom_dimensions)).toBe(true);
  }, 15_000);

  it("error: invalid property_id returns error", async () => {
    const result = await client.callTool({
      name: "ga4_run_report",
      arguments: {
        property_id: "999999999",
        dimensions: "date",
        metrics: "sessions",
        start_date: "7daysAgo",
        end_date: "today",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.error || data.error_type).toBeDefined();
  }, 15_000);
});
