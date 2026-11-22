/**
 * GA4_PROPERTY_ID is checked when the server loads its config.
 *
 * The id is spliced into every request as `properties/<id>`, so a measurement
 * ID (G-...), a typo or a value that already carries `properties/` used to
 * reach Google and come back as an opaque INVALID_ARGUMENT, or as
 * `properties/properties/<id>`. It must be numeric, optionally prefixed with
 * `properties/`, which is dropped.
 *
 * Containment: the startup cases import the real src/index.ts with the same
 * recording GA4 clients, OAuth stub, fetch stub and update-check mock as
 * retry.callSite.test.ts. ga4_get_client_context makes no API call, and a
 * rejected id throws before any client exists. Nothing reaches Google.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_ENV, FAKE_PROPERTY_ID, recorder } from "../tests/helpers/fakeGoogleAnalytics.js";
import { connectInMemory } from "../tests/helpers/connect.js";
import { parsePropertyId } from "./propertyId.js";

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

describe("parsePropertyId", () => {
  it.each([
    ["123456789", "123456789"],
    ["properties/123456789", "123456789"],
  ])("accepts %s as %s", (raw, id) => {
    expect(parsePropertyId(raw)).toBe(id);
  });

  it.each([
    "G-ABC123XYZ",
    "UA-12345-1",
    "abc",
    "123abc",
    "12.34",
    "-123",
    "123 456",
    "properties/",
    "properties/abc",
    "properties/properties/123",
    "Properties/123",
    "accounts/1/properties/123",
    "123/../456",
  ])("rejects %s, naming the variable and the value", (raw) => {
    expect(() => parsePropertyId(raw)).toThrow(/GA4_PROPERTY_ID/);
    expect(() => parsePropertyId(raw)).toThrow(JSON.stringify(raw));
    expect(() => parsePropertyId(raw)).toThrow(/numeric/);
  });

  it("says a G- value is a measurement ID", () => {
    expect(() => parsePropertyId("G-ABC123XYZ")).toThrow(/measurement ID/);
    expect(() => parsePropertyId("abc")).not.toThrow(/measurement ID/);
  });
});

describe("server startup with GA4_PROPERTY_ID", () => {
  beforeEach(() => {
    vi.resetModules();
    recorder.reset();
    vi.stubGlobal("fetch", async () => {
      throw new Error("network is disabled in this test");
    });
    for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refuses a measurement ID before any client is built", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", "G-ABC123XYZ");

    await expect(import("./index.js")).rejects.toThrow(/GA4_PROPERTY_ID must be a numeric GA4 property ID.*"G-ABC123XYZ"/);
    expect(recorder.constructed).toBe(0);
    expect(recorder.calls).toEqual([]);
  });

  it("drops a properties/ prefix, so the property is not addressed as properties/properties/...", async () => {
    vi.stubEnv("GA4_PROPERTY_ID", `properties/${FAKE_PROPERTY_ID}`);
    const { server } = await import("./index.js");
    const client = await connectInMemory(server);
    try {
      const result: any = await client.callTool({ name: "ga4_get_client_context", arguments: { working_directory: "/tmp" } });

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(result.content[0].text)).toEqual({
        client_name: "My Property",
        property_id: FAKE_PROPERTY_ID,
        folder: "",
        sandbox_measurement_id: null,
        production_measurement_id: null,
      });
    } finally {
      await client.close();
    }
  });
});
