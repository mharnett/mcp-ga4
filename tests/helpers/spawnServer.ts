/**
 * Launch the built server (dist/index.js, the `mcp-ga4` bin) the way an MCP
 * host does: a child process with piped stdio. Importing src/index.ts never
 * runs main(), so only a spawned server shows how it starts.
 *
 * The child gets a fixed env, not this process's: fake OAuth values, a
 * throwaway HOME, a config path that does not exist and
 * MCP_DISABLE_UPDATE_CHECK=1 (no npm registry check), plus whatever the test
 * adds. `preload` is the tests/helpers module that takes the network away.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FAKE_ENV } from "./fakeGoogleAnalytics.js";

const HELPERS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPERS, "..", "..");
const DIST_INDEX = path.join(REPO_ROOT, "dist", "index.js");

export const REPLY_TIMEOUT_MS = 15_000;

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunningServer {
  proc: ChildProcess;
  stdout(): string;
  stderr(): string;
  closed: Promise<Exit>;
  send(message: object): void;
  reply(id: number): Promise<any>;
  stop(): Promise<Exit>;
}

const running: RunningServer[] = [];

export function startServer(preload: "noNetwork.mjs" | "unreachableNetwork.mjs", extraEnv: Record<string, string>): RunningServer {
  if (!existsSync(DIST_INDEX)) {
    throw new Error(`${DIST_INDEX} is missing: run \`npm test\`, which builds first`);
  }
  const home = mkdtempSync(path.join(tmpdir(), "mcp-ga4-startup-"));
  const env: Record<string, string> = {};
  // process.env lookups are case-insensitive on Windows, so these two cover it.
  for (const key of ["PATH", "SystemRoot"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  Object.assign(
    env,
    FAKE_ENV,
    { HOME: home, USERPROFILE: home, LOG_LEVEL: "debug", MCP_DISABLE_UPDATE_CHECK: "1" },
    extraEnv,
  );

  const proc = spawn(process.execPath, ["--import", pathToFileURL(path.join(HELPERS, preload)).href, DIST_INDEX], {
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

/** Stop every server started since the last call. For afterEach. */
export async function stopServers(): Promise<void> {
  await Promise.all(running.splice(0).map((server) => server.stop()));
}

/** Wait until the server has written `text` to stderr. */
export async function stderrContains(server: RunningServer, text: string, ms = REPLY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  while (!server.stderr().includes(text)) {
    if (Date.now() > deadline) throw new Error(`stderr never contained ${JSON.stringify(text)} in ${ms}ms\nstderr:\n${server.stderr()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "startup-test", version: "0.0.0" },
  },
};
