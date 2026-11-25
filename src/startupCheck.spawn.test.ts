/**
 * `initialize` is answered before the startup auth check finishes.
 *
 * main() used to wait for the check before it connected the transport, so with
 * Google unreachable the client's `initialize` sat unanswered for the whole
 * 30s request timeout, past what MCP clients and health checks wait. The check
 * now runs beside the server, and a failure is reported on the first tool
 * call (startupCheck.callSite.test.ts).
 *
 * Containment: tests/helpers/spawnServer.ts (fixed env, fake credentials,
 * throwaway HOME). The preload leaves no working connection: noNetwork.mjs
 * refuses every one, unreachableNetwork.mjs resolves every host to a TEST-NET
 * address and lets the connection hang. No tool here calls Google.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { INITIALIZE, startServer, stderrContains, stopServers } from "../tests/helpers/spawnServer.js";

const FAILED = "[STARTUP WARNING] Auth check FAILED";

function contextCall(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "ga4_get_client_context", arguments: { working_directory: "/work" } },
  };
}

afterEach(stopServers);

describe("the startup auth check (spawned server)", () => {
  it("does not hold initialize, tools/list or a tool call while Google is unreachable", async () => {
    const server = startServer("unreachableNetwork.mjs", {});

    server.send(INITIALIZE);
    const init = await server.reply(1);
    expect(init.result.serverInfo.name).toBe("mcp-ga4");
    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((await server.reply(2)).result.tools.length).toBeGreaterThan(0);

    // The check is under way, in a connection that never opens, and has not given up.
    await stderrContains(server, "[unreachable] connect");
    expect(server.stderr()).not.toContain(FAILED);

    // A local tool is answered too, with nothing to report yet.
    server.send(contextCall(3));
    const call = await server.reply(3);
    expect(call.result.isError).toBeFalsy();
    expect(call.result.content).toHaveLength(1);
    expect(server.stderr()).not.toContain(FAILED);
  }, 60_000);
});

describe("a service-account key file that cannot be read (spawned server)", () => {
  // The Google client throws this outside any promise and takes the process
  // down, so it has to stop startup, as it did when the check came first,
  // rather than kill a server that has already answered initialize.
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "mcp-ga4-key-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 1 before answering initialize, naming the file", async () => {
    const keyFile = path.join(dir, "no-such-key.json");
    const server = startServer("noNetwork.mjs", { GOOGLE_APPLICATION_CREDENTIALS: keyFile });
    server.send(INITIALIZE);

    expect(await server.closed, server.stderr()).toEqual({ code: 1, signal: null });
    expect(server.stdout()).toBe("");
    expect(server.stderr()).toContain(keyFile);
    expect(server.stderr()).not.toContain("[startup] MCP GA4 server running");
    expect(server.stderr()).not.toContain("[no-network]");
  }, 30_000);
});
