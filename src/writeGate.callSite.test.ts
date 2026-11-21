/**
 * Write gate at the call site: drives the real tools/list and tools/call
 * handlers that src/index.ts registers, over an in-memory MCP transport.
 *
 * writeGate.test.ts proves assertWriteAllowed() and filterTools() work, but
 * it imports only tools.js, so deleting either call from src/index.ts left
 * every test green (review 2026-11-14). Here every WRITE_TOOLS name is called
 * through the server with GA4_MCP_WRITE unset and must be refused before any
 * GA4 client is built or called.
 *
 * Containment: the Data and Admin API clients are recording fakes
 * (tests/helpers/fakeGoogleAnalytics.ts), the OAuth client builder is
 * replaced so no Google auth object is made, fetch throws, and the npm update
 * check is mocked out. Nothing reaches Google.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { FAKE_ENV, FAKE_PROPERTY_ID, recorder } from "../tests/helpers/fakeGoogleAnalytics.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";
import { WRITE_TOOLS, WRITE_DISABLED_MESSAGE } from "./writeGate.js";
import { tools } from "./tools.js";

vi.mock("@google-analytics/data", async () => ({
  BetaAnalyticsDataClient: (await import("../tests/helpers/fakeGoogleAnalytics.js")).FakeBetaAnalyticsDataClient,
}));
vi.mock("@google-analytics/admin", async () => ({
  AnalyticsAdminServiceClient: (await import("../tests/helpers/fakeGoogleAnalytics.js")).FakeAnalyticsAdminServiceClient,
}));
vi.mock("./oauthClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./oauthClient.js")>()),
  buildClientAuthOptions: () => ({}),
}));
vi.mock("mcp-updatenotifier", () => ({ checkForUpdate: async () => undefined }));

const WRITE_TOOL_NAMES = [...WRITE_TOOLS].sort();

const ARG_SHAPES: Array<[string, Record<string, unknown>]> = [
  ["bare", { property_id: FAKE_PROPERTY_ID }],
  [
    "loaded",
    { property_id: FAKE_PROPERTY_ID, parameter_name: "plan_tier", display_name: "Plan tier", scope: "USER", description: "gate test" },
  ],
];

let client: Client;
let fetchCalls = 0;
let clientCallsDuringImport = -1;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    fetchCalls += 1;
    throw new Error("network is disabled in this test");
  });
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("GA4_MCP_WRITE", undefined);
  const { server } = await import("./index.js");
  await new Promise((r) => setTimeout(r, 50));
  clientCallsDuringImport = recorder.calls.length + recorder.constructed;
  client = await connectInMemory(server);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  recorder.reset();
  fetchCalls = 0;
});

afterEach(() => {
  vi.stubEnv("GA4_MCP_WRITE", undefined);
});

it("importing index.js does not start the server or call GA4", () => {
  expect(clientCallsDuringImport).toBe(0);
});

describe("write gate at the CallTool dispatch (GA4_MCP_WRITE unset)", () => {
  it("covers the custom dimension create tool", () => {
    expect(WRITE_TOOL_NAMES).toEqual(["ga4_create_custom_dimension"]);
  });

  describe.each(ARG_SHAPES)("%s arguments", (_shape, args) => {
    it.each(WRITE_TOOL_NAMES)("%s is refused before any GA4 client is built or called", async (name) => {
      const result: any = await client.callTool({ name, arguments: args });

      expect(result.isError).toBe(true);
      expect(bodyOf(result).message).toBe(`Tool "${name}" is a write operation. ${WRITE_DISABLED_MESSAGE}`);
      expect(recorder.calls).toEqual([]);
      expect(recorder.constructed).toBe(0);
      expect(fetchCalls).toBe(0);
    });
  });

  it("hides every write tool from tools/list and keeps every read tool", async () => {
    const { tools: listed } = await client.listTools();
    const names = listed.map((t) => t.name);
    expect(names.filter((n) => WRITE_TOOLS.has(n))).toEqual([]);
    expect(names.sort()).toEqual(tools.map((t) => t.name).filter((n) => !WRITE_TOOLS.has(n)).sort());
  });

  it("still lets a read tool through to the Admin client (the fake is on the dispatch path)", async () => {
    const result: any = await client.callTool({ name: "ga4_list_custom_dimensions", arguments: { property_id: FAKE_PROPERTY_ID } });

    expect(result.isError).toBeFalsy();
    expect(recorder.calls.map((c) => [c.method, c.request.parent])).toEqual([["listCustomDimensions", `properties/${FAKE_PROPERTY_ID}`]]);
  });
});

describe("write gate open (GA4_MCP_WRITE=true)", () => {
  beforeEach(() => {
    vi.stubEnv("GA4_MCP_WRITE", "true");
  });

  it("lists every tool, write tools included", async () => {
    const { tools: listed } = await client.listTools();
    expect(listed.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("lets the write tool through to the Admin client", async () => {
    const result: any = await client.callTool({ name: "ga4_create_custom_dimension", arguments: ARG_SHAPES[1][1] });

    expect(result.isError).toBeFalsy();
    expect(bodyOf(result)).toEqual({ created: "Plan tier", parameter_name: "plan_tier", scope: "USER" });
    expect(recorder.callsTo("createCustomDimension")).toHaveLength(1);
  });
});
