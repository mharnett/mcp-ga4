/**
 * Property ids from config.json and from the tools' `property_id` argument are
 * checked the same way GA4_PROPERTY_ID is (propertyId.test.ts).
 *
 * Each one is spliced into a request as `properties/<id>`. A config entry
 * holding a measurement ID (G-...), a typo, or a value that already carries
 * `properties/` used to load without complaint; a tool argument like
 * "123/../456" or "properties/properties/1" went to Google as written. Now a
 * bad config entry stops startup, naming the client and the file, and a bad
 * argument is refused with the structured invalid-argument envelope before
 * any GA4 client is built or called.
 *
 * Containment: the Data and Admin API clients are the recording fakes in
 * tests/helpers/fakeGoogleAnalytics.ts, the OAuth client builder is replaced
 * so no Google auth object is made, fetch throws, and the npm update check is
 * mocked out. The only file written is a config.json in a fresh temp dir.
 * Nothing reaches Google.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_ENV, FAKE_PROPERTY_ID } from "../tests/helpers/fakeGoogleAnalytics.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";
import { tools } from "./tools.js";

// The data mock also hands out the recorder its fakes write to (see below).
vi.mock("@google-analytics/data", async () => {
  const fakes = await import("../tests/helpers/fakeGoogleAnalytics.js");
  return { BetaAnalyticsDataClient: fakes.FakeBetaAnalyticsDataClient, fakeRecorder: fakes.recorder };
});
vi.mock("@google-analytics/admin", async () => ({
  AnalyticsAdminServiceClient: (await import("../tests/helpers/fakeGoogleAnalytics.js")).FakeAnalyticsAdminServiceClient,
}));
vi.mock("./oauthClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./oauthClient.js")>()),
  buildClientAuthOptions: () => ({}),
}));
vi.mock("mcp-updatenotifier", () => ({ checkForUpdate: async () => undefined }));

type Recorder = (typeof import("../tests/helpers/fakeGoogleAnalytics.js"))["recorder"];

// vi.resetModules() makes the test's own import of the fakes a fresh copy,
// while the mocks keep writing to the copy they first loaded. The recorder is
// read from the mocked module, so every "nothing was built or sent" check
// watches the fakes index.ts actually uses instead of passing vacuously.
let recorder: Recorder;
let dir: string;

beforeEach(async () => {
  vi.resetModules();
  recorder = ((await import("@google-analytics/data")) as unknown as { fakeRecorder: Recorder }).fakeRecorder;
  recorder.reset();
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
  dir = mkdtempSync(join(tmpdir(), "mcp-ga4-property-id-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

/** Point the server at a config.json holding one client, with GA4_PROPERTY_ID unset. */
function useConfig(client: Record<string, unknown>): string {
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ clients: { "site-a": { name: "Site A", folder: "/work/site-a", ...client } } }));
  vi.stubEnv("GA4_PROPERTY_ID", undefined);
  vi.stubEnv("MCP_GA4_CONFIG", path);
  return path;
}

describe("config.json property_id", () => {
  it.each<[string, unknown]>([
    ["a measurement ID", "G-ABC123XYZ"],
    ["a path", "123/../456"],
    ["a doubled prefix", "properties/properties/1"],
    ["a query string", "123?x=1"],
    ["an empty string", ""],
    ["null", null],
    ["a fraction", 12.5],
    ["a negative number", -1],
    ["a boolean", true],
  ])("refuses %s at startup, naming the client and the file", async (_label, bad) => {
    const path = useConfig({ property_id: bad });

    const loading = import("./index.js");
    await expect(loading).rejects.toThrow(/property_id of client "site-a" in .*config\.json must be a numeric GA4 property ID/);
    await expect(loading).rejects.toThrow(path);
    await expect(loading).rejects.toThrow(JSON.stringify(bad));
    expect(recorder.constructed).toBe(0);
    expect(recorder.calls).toEqual([]);
  });

  it("refuses a client with no property_id", async () => {
    useConfig({});
    await expect(import("./index.js")).rejects.toThrow(/property_id of client "site-a" .*Got \(missing\)/);
  });

  it("says a G- value is a measurement ID", async () => {
    useConfig({ property_id: "G-ABC123XYZ" });
    await expect(import("./index.js")).rejects.toThrow(/measurement ID/);
  });

  it.each<[string, unknown]>([
    ["a numeric string", FAKE_PROPERTY_ID],
    ["a properties/ prefix", `properties/${FAKE_PROPERTY_ID}`],
    ["a JSON number", Number(FAKE_PROPERTY_ID)],
  ])("loads %s and reports the bare id", async (_label, value) => {
    useConfig({ property_id: value });
    const { server } = await import("./index.js");
    const client = await connectInMemory(server);
    try {
      const result: any = await client.callTool({ name: "ga4_get_client_context", arguments: { working_directory: "/work/site-a/reports" } });
      expect(result.isError).toBeFalsy();
      expect(bodyOf(result).property_id).toBe(FAKE_PROPERTY_ID);
    } finally {
      await client.close();
    }
  });
});

// Every tool that takes a property_id, read from the schemas so a new one is covered.
const PROPERTY_TOOLS = tools.filter((t) => "property_id" in ((t.inputSchema as any).properties ?? {})).map((t) => t.name);

/** Arguments that satisfy each tool's other required fields. */
const OTHER_ARGS: Record<string, Record<string, unknown>> = {
  ga4_create_custom_dimension: { parameter_name: "plan_tier", display_name: "Plan tier" },
};

describe("the tools' property_id argument", () => {
  beforeEach(() => {
    // Writes are on, so the create tool reaches the property check instead of the write gate.
    vi.stubEnv("GA4_MCP_WRITE", "true");
  });

  it("covers every GA4 call tool", () => {
    expect(PROPERTY_TOOLS).toEqual(expect.arrayContaining(["ga4_run_report", "ga4_list_data_streams", "ga4_create_custom_dimension"]));
  });

  it.each(["G-ABC123XYZ", "123/../456", "properties/properties/1", "123?x=1", "abc", "12 34", "-1"])(
    "refuses %s on every tool before any client is built",
    async (bad) => {
      const { server } = await import("./index.js");
      const client = await connectInMemory(server);
      try {
        for (const name of PROPERTY_TOOLS) {
          const result: any = await client.callTool({ name, arguments: { ...OTHER_ARGS[name], property_id: bad } });
          expect(result.isError, name).toBe(true);
          const body = bodyOf(result);
          expect(body.error_type, name).toBe("Ga4InvalidArgumentError");
          expect(body.arg, name).toBe("property_id");
          expect(body.reason, name).toMatch(/numeric GA4 property ID/);
          expect(body.reason, name).toContain(JSON.stringify(bad));
        }
        expect(recorder.constructed).toBe(0);
        expect(recorder.calls).toEqual([]);
      } finally {
        await client.close();
      }
    },
  );

  it.each([`properties/${FAKE_PROPERTY_ID}`, ` ${FAKE_PROPERTY_ID} `])(
    "sends %j as properties/<id> exactly once in the path",
    async (value) => {
      const { server } = await import("./index.js");
      const client = await connectInMemory(server);
      try {
        for (const name of PROPERTY_TOOLS) {
          const result: any = await client.callTool({ name, arguments: { ...OTHER_ARGS[name], property_id: value } });
          expect(result.isError, `${name}: ${result.content[0].text}`).toBeFalsy();
        }
        expect(recorder.calls).toHaveLength(PROPERTY_TOOLS.length);
        for (const c of recorder.calls) {
          expect(c.request.property ?? c.request.parent, c.method).toBe(`properties/${FAKE_PROPERTY_ID}`);
        }
      } finally {
        await client.close();
      }
    },
  );
});
