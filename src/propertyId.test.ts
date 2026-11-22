/**
 * GA4_PROPERTY_ID is checked when the server loads its config.
 *
 * The id is spliced into every request as `properties/<id>`, so a measurement
 * ID (G-...), a typo or a value that already carries `properties/` used to
 * reach Google and come back as an opaque INVALID_ARGUMENT, or as
 * `properties/properties/<id>`. It must be numeric, optionally prefixed with
 * `properties/`, which is dropped.
 *
 * The startup cases launch the built server (dist/index.js, the `mcp-ga4`
 * bin) the way an MCP host does: a child process with piped stdio. Importing
 * src/index.ts never runs main(), so only a spawned server shows that it
 * starts, answers, and keeps stdout for JSON-RPC replies.
 *
 * Containment: the child gets a fixed env, not this process's: fake OAuth
 * values, a throwaway HOME, a config path that does not exist,
 * MCP_GA4_SKIP_STARTUP_CHECK=1 (no startup API call) and
 * MCP_DISABLE_UPDATE_CHECK=1 (no npm registry check). initialize, tools/list
 * and ga4_get_client_context make no API call. tests/helpers/noNetwork.mjs is
 * preloaded and refuses any socket, DNS lookup or fetch, and each case checks
 * it never fired.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { FAKE_ENV, FAKE_PROPERTY_ID } from "../tests/helpers/fakeGoogleAnalytics.js";
import { parsePropertyId } from "./propertyId.js";

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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = path.join(REPO_ROOT, "dist", "index.js");
const NO_NETWORK = pathToFileURL(path.join(REPO_ROOT, "tests", "helpers", "noNetwork.mjs")).href;
const REPLY_TIMEOUT_MS = 15_000;

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface RunningServer {
  proc: ChildProcess;
  stdout(): string;
  stderr(): string;
  closed: Promise<Exit>;
  send(message: object): void;
  reply(id: number): Promise<any>;
  stop(): Promise<Exit>;
}

const running: RunningServer[] = [];

function startServer(propertyId: string): RunningServer {
  if (!existsSync(DIST_INDEX)) {
    throw new Error(`${DIST_INDEX} is missing: run \`npm test\`, which builds first`);
  }
  const home = mkdtempSync(path.join(tmpdir(), "mcp-ga4-startup-"));
  const env: Record<string, string> = {};
  // process.env lookups are case-insensitive on Windows, so these two cover it.
  for (const key of ["PATH", "SystemRoot"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  Object.assign(env, FAKE_ENV, {
    GA4_PROPERTY_ID: propertyId,
    HOME: home,
    USERPROFILE: home,
    LOG_LEVEL: "debug",
    MCP_GA4_SKIP_STARTUP_CHECK: "1",
    MCP_DISABLE_UPDATE_CHECK: "1",
  });

  const proc = spawn(process.execPath, ["--import", NO_NETWORK, DIST_INDEX], {
    cwd: REPO_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // A write after the server has exited raises EPIPE here; the exit is what
  // the test reports, so don't let the pipe error crash the run.
  proc.stdin!.on("error", () => {});

  let out = "";
  let err = "";
  let partial = "";
  const replies = new Map<number, any>();
  const waiters = new Map<number, (message: any) => void>();
  proc.stdout!.setEncoding("utf8");
  proc.stderr!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    out += chunk;
    const lines = (partial + chunk).split("\n");
    partial = lines.pop()!;
    for (const line of lines) {
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // reported by the stdout check, not here
      }
      if (typeof message?.id === "number") {
        replies.set(message.id, message);
        waiters.get(message.id)?.(message);
      }
    }
  });
  proc.stderr!.on("data", (chunk: string) => {
    err += chunk;
  });

  const closed = new Promise<Exit>((resolve) => {
    proc.on("close", (code, signal) => resolve({ code, signal }));
  });

  const server: RunningServer = {
    proc,
    stdout: () => out,
    stderr: () => err,
    closed,
    send(message) {
      proc.stdin!.write(JSON.stringify(message) + "\n");
    },
    reply(id) {
      if (replies.has(id)) return Promise.resolve(replies.get(id));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no reply to request ${id} within ${REPLY_TIMEOUT_MS}ms\nstderr:\n${err}`)),
          REPLY_TIMEOUT_MS,
        );
        waiters.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        void closed.then(({ code, signal }) => {
          clearTimeout(timer);
          reject(new Error(`server exited (code ${code}, signal ${signal}) before replying to request ${id}\nstderr:\n${err}`));
        });
      });
    },
    async stop() {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.stdin!.end();
        proc.kill("SIGTERM");
        const timer = setTimeout(() => proc.kill("SIGKILL"), 5_000);
        await closed;
        clearTimeout(timer);
      }
      return closed;
    },
  };
  running.push(server);
  return server;
}

function exitWithin(server: RunningServer, ms: number): Promise<Exit> {
  return Promise.race([
    server.closed,
    new Promise<Exit>((_, reject) =>
      setTimeout(() => reject(new Error(`server still running after ${ms}ms\nstderr:\n${server.stderr()}`)), ms),
    ),
  ]);
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "startup-test", version: "0.0.0" },
  },
};

describe("server startup with GA4_PROPERTY_ID (spawned over stdio)", () => {
  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.stop()));
  });

  it("starts, answers, drops a properties/ prefix, and writes only JSON-RPC replies to stdout", async () => {
    const server = startServer(`properties/${FAKE_PROPERTY_ID}`);

    server.send(INITIALIZE);
    const init = await server.reply(1);
    expect(init.result.serverInfo.name).toBe("mcp-ga4");

    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    server.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ga4_get_client_context", arguments: { working_directory: "/tmp" } },
    });

    const list = await server.reply(2);
    expect(list.result.tools.map((t: any) => t.name)).toContain("ga4_get_client_context");

    const context = await server.reply(3);
    expect(context.result.isError).toBeFalsy();
    expect(JSON.parse(context.result.content[0].text)).toEqual({
      client_name: "My Property",
      property_id: FAKE_PROPERTY_ID,
      folder: "",
      sandbox_measurement_id: null,
      production_measurement_id: null,
    });

    // Still serving after the handshake, and main() got as far as the transport.
    expect(server.proc.exitCode).toBeNull();
    expect(server.stderr()).toContain("[startup] MCP GA4 server running");

    await server.stop();

    // stdout carries the three replies and nothing else: no log line, no banner.
    const stdoutLines = server.stdout().split("\n").filter((line) => line.trim() !== "");
    const frames = stdoutLines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`non-JSON on stdout: ${line.slice(0, 200)}`);
      }
    });
    expect(frames.map((f) => [f.jsonrpc, f.id]).sort((a, b) => a[1] - b[1])).toEqual([
      ["2.0", 1],
      ["2.0", 2],
      ["2.0", 3],
    ]);
    expect(server.stderr()).not.toContain("[no-network]");
  }, 30_000);

  it("refuses a measurement ID: exits non-zero before building its auth or answering, with nothing on stdout", async () => {
    const server = startServer("G-ABC123XYZ");
    server.send(INITIALIZE);

    const { code } = await exitWithin(server, REPLY_TIMEOUT_MS);

    expect(code).not.toBeNull();
    expect(code).not.toBe(0);
    expect(server.stderr()).toMatch(/GA4_PROPERTY_ID must be a numeric GA4 property ID.*"G-ABC123XYZ"/);
    expect(server.stderr()).toMatch(/measurement ID/);
    expect(server.stderr()).not.toContain("[startup] Auth mode");
    expect(server.stderr()).not.toContain("[startup] MCP GA4 server running");
    expect(server.stdout()).toBe("");
    expect(server.stderr()).not.toContain("[no-network]");
  }, 30_000);
});
