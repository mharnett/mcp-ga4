/**
 * Non-idempotent writes must not be retried.
 *
 * withResilience() retries any transient failure up to three more times. A
 * ga4_create_custom_dimension that fails with UNAVAILABLE after GA4 stored
 * the dimension would be sent again, and the retry would come back
 * ALREADY_EXISTS, hiding that the first call worked. It goes out once.
 * Reads still retry.
 *
 * Containment: same recording client, OAuth, fetch and update-check fakes as
 * writeGate.callSite.test.ts. Nothing reaches Google.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { FAKE_ENV, FAKE_PROPERTY_ID, recorder } from "../tests/helpers/fakeGoogleAnalytics.js";
import { connectInMemory } from "../tests/helpers/connect.js";

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

let client: Client;

beforeAll(async () => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("GA4_MCP_WRITE", "true");
  const { server } = await import("./index.js");
  client = await connectInMemory(server);
});

afterAll(async () => {
  await client?.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  recorder.reset();
  recorder.fail = () => Object.assign(new Error("14 UNAVAILABLE: connection reset"), { code: 14 });
});

describe("a call that fails with UNAVAILABLE", () => {
  it("ga4_create_custom_dimension is sent exactly once", async () => {
    const result: any = await client.callTool({
      name: "ga4_create_custom_dimension",
      arguments: { property_id: FAKE_PROPERTY_ID, parameter_name: "plan_tier", display_name: "Plan tier" },
    });

    expect(result.isError).toBe(true);
    expect(recorder.callsTo("createCustomDimension")).toHaveLength(1);
  }, 20_000);

  it("a read (ga4_list_custom_dimensions) is still retried", async () => {
    const result: any = await client.callTool({ name: "ga4_list_custom_dimensions", arguments: { property_id: FAKE_PROPERTY_ID } });

    expect(result.isError).toBe(true);
    expect(recorder.callsTo("listCustomDimensions").length).toBeGreaterThan(1);
  }, 20_000);
});
