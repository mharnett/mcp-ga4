// ============================================
// mcp-ga4-setup (src/setup.ts) -- client registration.
// ============================================
// The wizard used to register only with Claude Code CLI (`claude mcp add`), so
// Claude Desktop users saw "success" and then no ga4 server. These tests lock
// the Desktop-aware behaviour: write the Desktop config (preserving everything
// else), refuse to clobber invalid JSON, stay idempotent, and register with
// BOTH clients when both are present. Importing setup.ts must not run the CLI.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildServerEntry,
  writeDesktopConfig,
  registerClaudeCode,
  resolveDesktopConfigPath,
  parseArgs,
  planTargets,
  runRegistration,
  type Exec,
} from "./setup.js";

let dir: string;
let desktopPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-ga4-setup-"));
  desktopPath = join(dir, "Claude", "claude_desktop_config.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const entry = buildServerEntry({
  propertyId: "331956119",
  credentialsFile: "/Users/x/.config/mcp-ga4/sa.json",
});

/** Records every exec call; `claude --version` succeeds unless told otherwise. */
function fakeExec(opts: { cliPresent?: boolean } = {}): Exec & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (args[0] === "--version" && opts.cliPresent === false) {
      throw new Error("ENOENT");
    }
    if (args[0] === "mcp" && args[1] === "remove") throw new Error("not found");
    return "";
  }) as Exec & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

describe("buildServerEntry", () => {
  it("builds an npx entry carrying the property id and credentials", () => {
    expect(entry).toEqual({
      command: "npx",
      args: ["-y", "mcp-ga4"],
      env: {
        GA4_PROPERTY_ID: "331956119",
        GOOGLE_APPLICATION_CREDENTIALS: "/Users/x/.config/mcp-ga4/sa.json",
      },
    });
  });

  it("carries the OAuth trio when no keyfile is given", () => {
    const e = buildServerEntry({
      propertyId: "1234567",
      oauth: { clientId: "cid", clientSecret: "cs", refreshToken: "rt" },
    });
    expect(e.env).toEqual({
      GA4_PROPERTY_ID: "1234567",
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "cs",
      GA4_REFRESH_TOKEN: "rt",
    });
  });
});

describe("resolveDesktopConfigPath", () => {
  it("uses Application Support on macOS", () => {
    expect(resolveDesktopConfigPath("darwin", "/Users/k", {})).toBe(
      "/Users/k/Library/Application Support/Claude/claude_desktop_config.json",
    );
  });
  it("uses %APPDATA% on Windows", () => {
    expect(
      resolveDesktopConfigPath("win32", "C:\\Users\\k", { APPDATA: "/appdata" }),
    ).toBe(join("/appdata", "Claude", "claude_desktop_config.json"));
  });
});

describe("writeDesktopConfig", () => {
  it("desktop config write preserves sibling MCPs and unrelated top-level keys", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    const before = {
      theme: "dark",
      globalShortcut: "Cmd+Space",
      mcpServers: {
        "google-ads": { command: "npx", args: ["-y", "mcp-google-ads@latest"] },
        ga4: { command: "node", args: ["/old/path.js"] },
      },
    };
    writeFileSync(desktopPath, JSON.stringify(before, null, 2));

    writeDesktopConfig(desktopPath, entry);

    const after = JSON.parse(readFileSync(desktopPath, "utf8"));
    expect(after).toEqual({
      theme: "dark",
      globalShortcut: "Cmd+Space",
      mcpServers: {
        "google-ads": { command: "npx", args: ["-y", "mcp-google-ads@latest"] },
        ga4: entry,
      },
    });
    // Key order of siblings survives (ga4 replaced in place, not reordered).
    expect(Object.keys(after)).toEqual(["theme", "globalShortcut", "mcpServers"]);
  });

  it("corrupt JSON aborts without writing (no clobber)", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    const corrupt = '{ "mcpServers": { "google-ads": { ,,, }';
    writeFileSync(desktopPath, corrupt);

    expect(() => writeDesktopConfig(desktopPath, entry)).toThrow(/not valid JSON/);
    expect(readFileSync(desktopPath, "utf8")).toBe(corrupt);
  });

  it("refuses a JSON file whose top level is not an object", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    writeFileSync(desktopPath, "[1,2,3]");
    expect(() => writeDesktopConfig(desktopPath, entry)).toThrow(/not a JSON object/);
    expect(readFileSync(desktopPath, "utf8")).toBe("[1,2,3]");
  });

  it("re-running setup twice produces an identical config (idempotent)", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    writeFileSync(desktopPath, JSON.stringify({ mcpServers: { other: { command: "x" } } }));

    writeDesktopConfig(desktopPath, entry);
    const first = readFileSync(desktopPath, "utf8");
    writeDesktopConfig(desktopPath, entry);
    const second = readFileSync(desktopPath, "utf8");

    expect(second).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
  });

  it("creates the file when the Claude dir exists but no config yet", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    const r = writeDesktopConfig(desktopPath, entry);
    expect(r.existed).toBe(false);
    expect(JSON.parse(readFileSync(desktopPath, "utf8"))).toEqual({ mcpServers: { ga4: entry } });
  });
});

describe("registerClaudeCode", () => {
  it("removes then re-adds ga4 at user scope with env flags, via argv (no shell)", () => {
    const exec = fakeExec();
    registerClaudeCode(entry, exec);
    expect(exec.calls).toEqual([
      ["claude", "mcp", "remove", "ga4", "-s", "user"],
      [
        "claude", "mcp", "add", "-s", "user",
        "-e", "GA4_PROPERTY_ID=331956119",
        "-e", "GOOGLE_APPLICATION_CREDENTIALS=/Users/x/.config/mcp-ga4/sa.json",
        "ga4", "--", "npx", "-y", "mcp-ga4",
      ],
    ]);
  });
});

describe("parseArgs / planTargets", () => {
  it("parses the client-selection flags", () => {
    expect(parseArgs(["--claude-desktop-only"]).only).toBe("desktop");
    expect(parseArgs(["--claude-code-only"]).only).toBe("code");
    expect(parseArgs(["--property-id", "123456", "--credentials", "/k.json"])).toMatchObject({
      propertyId: "123456",
      credentialsFile: "/k.json",
    });
  });

  it("rejects both -only flags together", () => {
    expect(() => parseArgs(["--claude-desktop-only", "--claude-code-only"])).toThrow(/mutually exclusive/);
  });

  it("targets every detected client by default and honours -only flags", () => {
    const both = { desktopDetected: true, cliDetected: true };
    expect(planTargets(both, undefined)).toEqual({ desktop: true, code: true });
    expect(planTargets(both, "desktop")).toEqual({ desktop: true, code: false });
    expect(planTargets(both, "code")).toEqual({ desktop: false, code: true });
    expect(planTargets({ desktopDetected: true, cliDetected: false }, undefined)).toEqual({
      desktop: true,
      code: false,
    });
    // An explicit -only flag forces that target even if detection missed it.
    expect(planTargets({ desktopDetected: false, cliDetected: false }, "desktop")).toEqual({
      desktop: true,
      code: false,
    });
  });
});

describe("runRegistration", () => {
  it("when both Claude Code CLI and Desktop config exist, both get written", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    writeFileSync(desktopPath, JSON.stringify({ mcpServers: {} }));
    const exec = fakeExec({ cliPresent: true });

    const result = runRegistration({ entry, desktopConfigPath: desktopPath, exec });

    expect(result).toEqual({ desktop: "written", code: "written" });
    expect(JSON.parse(readFileSync(desktopPath, "utf8")).mcpServers.ga4).toEqual(entry);
    expect(exec.calls.some((c) => c[1] === "mcp" && c[2] === "add")).toBe(true);
  });

  it("Desktop-only machine (no claude CLI) still gets the Desktop config", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    const exec = fakeExec({ cliPresent: false });

    const result = runRegistration({ entry, desktopConfigPath: desktopPath, exec });

    expect(result).toEqual({ desktop: "written", code: "skipped" });
    expect(existsSync(desktopPath)).toBe(true);
    expect(exec.calls.some((c) => c[1] === "mcp")).toBe(false);
  });

  it("--claude-code-only leaves the Desktop config untouched", () => {
    mkdirSync(join(dir, "Claude"), { recursive: true });
    writeFileSync(desktopPath, "{}");
    const exec = fakeExec({ cliPresent: true });

    const result = runRegistration({ entry, desktopConfigPath: desktopPath, exec, only: "code" });

    expect(result).toEqual({ desktop: "skipped", code: "written" });
    expect(readFileSync(desktopPath, "utf8")).toBe("{}");
  });

  it("reports nothing-detected instead of claiming success", () => {
    const exec = fakeExec({ cliPresent: false });
    const result = runRegistration({ entry, desktopConfigPath: desktopPath, exec });
    expect(result).toEqual({ desktop: "skipped", code: "skipped" });
    expect(existsSync(desktopPath)).toBe(false);
  });
});

describe("packaging wiring (the join between mcp-ga4 and the mcp-ga4-setup wrapper)", () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  );

  it("ships an mcp-ga4-setup bin pointing at dist/setup.js", () => {
    expect(pkg.bin["mcp-ga4-setup"]).toBe("dist/setup.js");
  });

  it("exports ./setup so the wrapper package can import it past the exports map", () => {
    expect(pkg.exports["./setup"]).toEqual({
      import: "./dist/setup.js",
      types: "./dist/setup.d.ts",
    });
  });

  it("exposes runCli for wrappers (the main-module guard is false when imported)", async () => {
    const mod = await import("./setup.js");
    expect(typeof mod.runCli).toBe("function");
  });
});
