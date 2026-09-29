#!/usr/bin/env node
// ============================================
// mcp-ga4-setup -- register the GA4 server with Claude Desktop AND Claude Code.
// ============================================
// The previous wizard ended with `claude mcp add -s user ...`, which only writes
// Claude Code CLI's config (~/.claude.json). A Claude Desktop user (reads
// claude_desktop_config.json) saw "success" and then no ga4 server at all.
//
// This version detects each client and registers with every one it finds:
//   - Claude Desktop: merge mcpServers.ga4 into claude_desktop_config.json.
//     Sibling MCPs and unrelated top-level keys are preserved; invalid JSON
//     aborts without writing; re-running is byte-for-byte idempotent.
//   - Claude Code CLI: `claude mcp remove ga4 -s user` then
//     `claude mcp add -s user -e ... ga4 -- npx -y mcp-ga4`, invoked via argv
//     (execFileSync), never through a shell.
// --claude-desktop-only / --claude-code-only restrict the targets.
//
// Credentials are NOT minted here. Pass a service-account keyfile
// (--credentials / GOOGLE_APPLICATION_CREDENTIALS) or export the OAuth trio
// produced by `npx mcp-ga4-auth` (GA4_CLIENT_ID / GA4_CLIENT_SECRET /
// GA4_REFRESH_TOKEN) before running.

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";

export const SERVER_NAME = "ga4";

/** Runs a program with an argv array (no shell); returns stdout. Throws on non-zero exit. */
export type Exec = (file: string, args: string[]) => string;

export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface EntryInput {
  propertyId: string;
  credentialsFile?: string;
  oauth?: { clientId: string; clientSecret: string; refreshToken: string };
}

export type Only = "desktop" | "code";

export function buildServerEntry(input: EntryInput): ServerEntry {
  const env: Record<string, string> = { GA4_PROPERTY_ID: input.propertyId };
  if (input.credentialsFile) {
    env.GOOGLE_APPLICATION_CREDENTIALS = input.credentialsFile;
  } else if (input.oauth) {
    env.GA4_CLIENT_ID = input.oauth.clientId;
    env.GA4_CLIENT_SECRET = input.oauth.clientSecret;
    env.GA4_REFRESH_TOKEN = input.oauth.refreshToken;
  }
  return { command: "npx", args: ["-y", "mcp-ga4"], env };
}

export function resolveDesktopConfigPath(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  switch (platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
    default:
      return join(home, ".config", "Claude", "claude_desktop_config.json");
  }
}

/** Desktop counts as installed when its config file OR its Claude dir exists. */
export function detectDesktop(configPath: string): boolean {
  return existsSync(configPath) || existsSync(dirname(configPath));
}

export function detectClaudeCli(exec: Exec): boolean {
  try {
    exec("claude", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export function writeDesktopConfig(
  configPath: string,
  entry: ServerEntry,
): { path: string; existed: boolean } {
  const existed = existsSync(configPath);
  let config: Record<string, unknown> = {};
  if (existed) {
    const raw = readFileSync(configPath, "utf8");
    if (raw.trim().length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          `Claude Desktop config at ${configPath} is not valid JSON. Refusing to overwrite. ` +
            `Fix the syntax (or delete the file to start fresh), then re-run.`,
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          `Claude Desktop config at ${configPath} is not a JSON object. Refusing to overwrite.`,
        );
      }
      config = parsed as Record<string, unknown>;
    }
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
  }

  const servers =
    config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: entry } };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n");
  return { path: configPath, existed };
}

export function registerClaudeCode(entry: ServerEntry, exec: Exec): void {
  try {
    exec("claude", ["mcp", "remove", SERVER_NAME, "-s", "user"]);
  } catch {
    // not registered yet -- fine
  }
  const envFlags = Object.entries(entry.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  exec("claude", [
    "mcp", "add", "-s", "user",
    ...envFlags,
    SERVER_NAME, "--", entry.command, ...entry.args,
  ]);
}

export interface CliArgs {
  help: boolean;
  only?: Only;
  propertyId?: string;
  credentialsFile?: string;
  desktopConfigPath?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false };
  let desktopOnly = false;
  let codeOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--claude-desktop-only") desktopOnly = true;
    else if (a === "--claude-code-only") codeOnly = true;
    else if (a === "--property-id" && argv[i + 1]) out.propertyId = argv[++i];
    else if (a === "--credentials" && argv[i + 1]) out.credentialsFile = argv[++i];
    else if (a === "--desktop-config" && argv[i + 1]) out.desktopConfigPath = argv[++i];
    else throw new Error(`Unknown or incomplete argument: ${a} (see --help)`);
  }
  if (desktopOnly && codeOnly) {
    throw new Error("--claude-desktop-only and --claude-code-only are mutually exclusive");
  }
  if (desktopOnly) out.only = "desktop";
  if (codeOnly) out.only = "code";
  return out;
}

export function planTargets(
  detected: { desktopDetected: boolean; cliDetected: boolean },
  only: Only | undefined,
): { desktop: boolean; code: boolean } {
  if (only === "desktop") return { desktop: true, code: false };
  if (only === "code") return { desktop: false, code: true };
  return { desktop: detected.desktopDetected, code: detected.cliDetected };
}

export type TargetResult = "written" | "skipped";

export function runRegistration(opts: {
  entry: ServerEntry;
  desktopConfigPath: string;
  exec: Exec;
  only?: Only;
}): { desktop: TargetResult; code: TargetResult } {
  const targets = planTargets(
    {
      desktopDetected: detectDesktop(opts.desktopConfigPath),
      cliDetected: opts.only === "desktop" ? false : detectClaudeCli(opts.exec),
    },
    opts.only,
  );
  // Validate/write Desktop first: a corrupt Desktop config aborts before we
  // touch the CLI registration, so a failed run changes nothing.
  if (targets.desktop) writeDesktopConfig(opts.desktopConfigPath, opts.entry);
  if (targets.code) registerClaudeCode(opts.entry, opts.exec);
  return {
    desktop: targets.desktop ? "written" : "skipped",
    code: targets.code ? "written" : "skipped",
  };
}

// ── Interactive CLI (guarded behind main; not exercised by unit tests) ───────

const realExec: Exec = (file, args) =>
  execFileSync(file, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) =>
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    }),
  );
}

function printHelp(): void {
  process.stdout.write(
    [
      "mcp-ga4-setup -- connect Claude Desktop and/or Claude Code to Google Analytics 4",
      "",
      "Usage:",
      "  npx mcp-ga4-setup [--property-id <id>] [--credentials <keyfile.json>]",
      "",
      "Options:",
      "  --property-id <id>       GA4 property ID (prompted if omitted)",
      "  --credentials <path>     Service-account keyfile (else GOOGLE_APPLICATION_CREDENTIALS,",
      "                           else the GA4_CLIENT_ID/GA4_CLIENT_SECRET/GA4_REFRESH_TOKEN",
      "                           env vars from `npx mcp-ga4-auth`)",
      "  --claude-desktop-only    Only write the Claude Desktop config",
      "  --claude-code-only       Only register with the Claude Code CLI",
      "  --desktop-config <path>  Override the Claude Desktop config path",
      "  -h, --help               Show this help",
      "",
      `Claude Desktop config: ${resolveDesktopConfigPath()}`,
      "",
    ].join("\n"),
  );
}

async function resolveEntryInput(args: CliArgs): Promise<EntryInput> {
  const env = (k: string) => (process.env[k] || "").trim();
  let propertyId = args.propertyId || env("GA4_PROPERTY_ID");
  while (!/^\d{6,12}$/.test(propertyId)) {
    if (!process.stdin.isTTY) {
      throw new Error("GA4 property ID missing or invalid -- pass --property-id <numeric id>.");
    }
    if (propertyId) console.log("  Enter just the numeric ID (e.g. 331956119).");
    console.log("Find it at GA4 > Admin > Property details > Property ID.");
    propertyId = await ask("GA4 property ID: ");
  }

  const keyFile = args.credentialsFile || env("GOOGLE_APPLICATION_CREDENTIALS");
  if (keyFile) {
    const abs = resolve(keyFile);
    if (!existsSync(abs)) throw new Error(`Credentials file not found: ${abs}`);
    return { propertyId, credentialsFile: abs };
  }
  const clientId = env("GA4_CLIENT_ID");
  const clientSecret = env("GA4_CLIENT_SECRET");
  const refreshToken = env("GA4_REFRESH_TOKEN");
  if (clientId && clientSecret && refreshToken) {
    return { propertyId, oauth: { clientId, clientSecret, refreshToken } };
  }
  throw new Error(
    "No GA4 credentials found. Either pass --credentials <service-account.json>, or run " +
      "`npx mcp-ga4-auth` and export GA4_CLIENT_ID, GA4_CLIENT_SECRET and GA4_REFRESH_TOKEN, " +
      "then re-run mcp-ga4-setup.",
  );
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const entry = buildServerEntry(await resolveEntryInput(args));
  const desktopConfigPath = args.desktopConfigPath || resolveDesktopConfigPath();
  const result = runRegistration({ entry, desktopConfigPath, exec: realExec, only: args.only });

  if (result.desktop === "skipped" && result.code === "skipped") {
    console.error(
      "\nNo Claude client detected: no Claude Desktop config directory and no `claude` CLI on PATH.\n" +
        "Install Claude Desktop or Claude Code, then re-run. Nothing was written.",
    );
    return 1;
  }
  console.log("");
  if (result.desktop === "written") {
    console.log(`Claude Desktop: registered "${SERVER_NAME}" in ${desktopConfigPath}`);
    console.log("  -> Fully quit Claude Desktop (Cmd+Q, not just close the window) and reopen it.");
  }
  if (result.code === "written") {
    console.log(`Claude Code:    registered "${SERVER_NAME}" at user scope`);
    console.log("  -> Restart any running `claude` session.");
  }
  console.log('\nThen ask: "What were my top 10 pages last week?"');
  return 0;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    // realpath both sides: npx runs bins through a symlink in node_modules/.bin
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/** Run the CLI and exit the process. Entry point for the mcp-ga4-setup wrapper package. */
export function runCli(argv: string[] = process.argv.slice(2)): Promise<never> {
  return main(argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`\nSetup failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}

if (isMainModule()) void runCli();
