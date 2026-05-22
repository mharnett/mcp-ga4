/**
 * Input validation: bug canary.
 *
 * Bug history (BACKLOG.md, surfaced 2026-05-21): invoking `ga4_run_report`
 * with `property_id="undefined"` (the literal four-character string, not
 * JS undefined) caused the server to hang — no JSON-RPC response within 6s.
 * Cause: dispatch in src/index.ts cast `args?.property_id as string` without
 * validation, then the GA4 client deadlocked / pended on a malformed
 * property path.
 *
 * Fix: requireStringArg(name, value) rejects undefined, null, empty,
 * whitespace-only, and the sentinels "undefined" / "null".
 *
 * This test spawns the actual MCP server over stdio and asserts the bug
 * case returns a structured error envelope quickly (< 3s, well below the
 * 6s hang threshold from the original chaos test). It uses bogus
 * credentials because validation must run BEFORE any GA4 API call — so
 * no network access is required for this test to be meaningful.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DIST_INDEX = join(REPO_ROOT, "dist", "index.js");

// Service-account JSON shape that parses cleanly but has no API access. The
// server only reads this file at startup; validation runs before any actual
// API call, so the bogus creds never hit the wire.
const FAKE_CREDS = {
  type: "service_account",
  project_id: "fake-project",
  private_key_id: "0".repeat(40),
  // Syntactically valid PEM block — content is not parsed unless used.
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAUEwggE9AgEAAkEAq7BFUpkGp3+LQmlQ\nYx2eqzDV+xeG8kx/sQFV18S5JhzGeIJNA72wSeukEPojtqUyX2J0CciPBh7eqclQ\n2zpAswIDAQABAkAQfMtPtVfNcKQt8FjA9bIyRoUqDTr1RAd/zHGE0nfTQzvqDA62\nXjzGRZ7G+VnY9JePiNK/UkPmiWb9MoYrYxYBAiEA4KRfk6dkF8M0XQzWQYWtR4dF\nLrXJxqpa1XLBTNi3mZECIQDB0PucBhP5Bdfp1lOtPLpQzKKGiK6f5R5tQwHHGuoo\nIwIhAJqaFCzNV6OArm08iEm4ZqVl0qBpwHvJfqPpKZUk6kfBAiEAo7vY9zG9TJYz\nz4iLs8sFOWMtoFKw5HCXJ7FZQU/V8nMCIQDA6f7Y3Vmkn6lQT9bIaXMmvbELT/ru\n7BX8X7l1g5DK+w==\n-----END PRIVATE KEY-----\n",
  client_email: "fake@fake-project.iam.gserviceaccount.com",
  client_id: "0".repeat(21),
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
}

describe.skipIf(!existsSync(DIST_INDEX))("mcp-ga4 input validation (bug canary)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-ga4-test-"));
    const credsPath = join(tmpDir, "fake-creds.json");
    writeFileSync(credsPath, JSON.stringify(FAKE_CREDS));

    transport = new StdioClientTransport({
      command: "node",
      args: [DIST_INDEX],
      cwd: REPO_ROOT,
      env: {
        // Server only needs creds to start. Validation runs before any GA4
        // API call, so the fake key never goes on the wire.
        ...process.env,
        GA4_PROPERTY_ID: "000000000",
        GOOGLE_APPLICATION_CREDENTIALS: credsPath,
        MCP_GA4_CONFIG: "/nonexistent/test-config.json",
        // Skip the gRPC startup health check (fake creds would hang on retries)
        MCP_GA4_SKIP_STARTUP_CHECK: "1",
      } as Record<string, string>,
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('ga4_run_report with property_id="undefined" returns structured error fast (does not hang)', async () => {
    const start = Date.now();
    const result = await client.callTool({
      name: "ga4_run_report",
      arguments: {
        property_id: "undefined",
        dimensions: "date",
        metrics: "sessions",
        start_date: "7daysAgo",
        end_date: "today",
      },
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(3_000);
    expect(result.isError).toBe(true);

    const data = parseToolResult(result);
    expect(data.error_type).toBe("Ga4InvalidArgumentError");
    expect(data.arg).toBe("property_id");
    expect(data.reason).toContain("sentinel");
  }, 6_000);

  it("ga4_run_report with missing property_id returns structured error", async () => {
    const result = await client.callTool({
      name: "ga4_run_report",
      arguments: {
        dimensions: "date",
        metrics: "sessions",
        start_date: "7daysAgo",
        end_date: "today",
      },
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result);
    expect(data.error_type).toBe("Ga4InvalidArgumentError");
    expect(data.arg).toBe("property_id");
  }, 6_000);

  it('ga4_run_report with property_id="" returns structured error', async () => {
    const result = await client.callTool({
      name: "ga4_run_report",
      arguments: { property_id: "" },
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result);
    expect(data.error_type).toBe("Ga4InvalidArgumentError");
  }, 6_000);

  it("ga4_list_data_streams also validates property_id", async () => {
    const result = await client.callTool({
      name: "ga4_list_data_streams",
      arguments: { property_id: "undefined" },
    });
    expect(result.isError).toBe(true);
    const data = parseToolResult(result);
    expect(data.error_type).toBe("Ga4InvalidArgumentError");
  }, 6_000);
});
