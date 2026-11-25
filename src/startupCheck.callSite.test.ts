/**
 * A failed startup auth check is reported on the first tool call.
 *
 * Drives the real tools/call handler and runStartupCheck() of src/index.ts
 * over an in-memory transport. That main() starts the check, and does not wait
 * for it, is shown by the spawned server in startupCheck.spawn.test.ts.
 *
 * Containment: same recording client, OAuth, fetch and update-check fakes as
 * writeGate.callSite.test.ts. Nothing reaches Google.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FAKE_ENV, FAKE_PROPERTY_ID } from "../tests/helpers/fakeGoogleAnalytics.js";
import { bodyOf, connectInMemory } from "../tests/helpers/connect.js";

// The data mock also hands out the recorder its fakes write to (see
// propertyId.callSite.test.ts).
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
let recorder: Recorder;

const DENIED = () => Object.assign(new Error("7 PERMISSION_DENIED: caller lacks access"), { code: 7 });
const CONTEXT = { name: "ga4_get_client_context", arguments: { working_directory: "/work" } };
const DIMENSIONS = { name: "ga4_list_custom_dimensions", arguments: { property_id: FAKE_PROPERTY_ID } };

beforeEach(async () => {
  vi.resetModules();
  recorder = ((await import("@google-analytics/data")) as unknown as { fakeRecorder: Recorder }).fakeRecorder;
  recorder.reset();
  vi.stubGlobal("fetch", async () => {
    throw new Error("network is disabled in this test");
  });
  for (const [k, v] of Object.entries(FAKE_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function connected() {
  const { server, runStartupCheck } = await import("./index.js");
  return { client: await connectInMemory(server), runStartupCheck };
}

describe("a failed startup check", () => {
  it("is reported on the first tool call, after the tool's own answer, and not again", async () => {
    const { client, runStartupCheck } = await connected();
    recorder.fail = DENIED;
    await runStartupCheck();

    const first: any = await client.callTool(CONTEXT);
    expect(first.isError).toBeFalsy();
    expect(bodyOf(first).property_id).toBe(FAKE_PROPERTY_ID);
    expect(first.content).toHaveLength(2);
    expect(JSON.parse(first.content[1].text)).toMatchObject({
      startup_check: "failed",
      message: expect.stringContaining("PERMISSION_DENIED"),
    });

    const second: any = await client.callTool(CONTEXT);
    expect(second.content).toEqual([first.content[0]]);
    await client.close();
  });

  it("is reported beside a tool error too, leaving the error envelope first", async () => {
    const { client, runStartupCheck } = await connected();
    recorder.fail = DENIED;
    await runStartupCheck();

    const result: any = await client.callTool(DIMENSIONS);
    expect(result.isError).toBe(true);
    expect(bodyOf(result).error_type).toBe("Ga4AuthError");
    expect(result.content).toHaveLength(2);
    await client.close();
  });
});

describe("a startup check that passed", () => {
  it("asks for the first property's data streams once and adds nothing to a tool result", async () => {
    const { client, runStartupCheck } = await connected();
    await runStartupCheck();
    expect(recorder.callsTo("listDataStreams").map((c) => c.request)).toEqual([{ parent: `properties/${FAKE_PROPERTY_ID}` }]);

    const result: any = await client.callTool(DIMENSIONS);
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    await client.close();
  });
});
