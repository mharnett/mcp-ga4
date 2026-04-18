#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { join, dirname, resolve, isAbsolute } from "path";
import { homedir } from "os";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin";
import { GoogleAuth } from "google-auth-library";
import {
  Ga4AuthError,
  Ga4RateLimitError,
  Ga4ServiceError,
  classifyError,
} from "./errors.js";
import { tools } from "./tools.js";
import { withResilience, safeResponse, logger } from "./resilience.js";
import { checkForUpdate } from "./updateNotifier.js";
import v8 from "v8";

// CLI package info
const __cliPkg = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf-8"));

// Log build fingerprint at startup
try {
  const __buildInfoDir = dirname(new URL(import.meta.url).pathname);
  const buildInfo = JSON.parse(readFileSync(join(__buildInfoDir, "build-info.json"), "utf-8"));
  console.error(`[build] SHA: ${buildInfo.sha} (${buildInfo.builtAt})`);
} catch {
  console.error(`[build] ${__cliPkg.name}@${__cliPkg.version} (dev mode)`);
}

// Version safety: warn if running a deprecated or dangerously old version
const __minimumSafeVersion = "2.0.1"; // minimum version with input sanitization
const __semverLt = (a: string, b: string) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) < (pb[i] || 0)) return true; if ((pa[i] || 0) > (pb[i] || 0)) return false; } return false; };
if (__semverLt(__cliPkg.version, __minimumSafeVersion)) {
  console.error(`[WARNING] Running deprecated version ${__cliPkg.version}. Minimum safe version is ${__minimumSafeVersion}. Please upgrade.`);
}

// Fire-and-forget npm outdated check. Non-blocking; any error is swallowed.
void checkForUpdate(__cliPkg.name, __cliPkg.version).catch(() => {});

// CLI flags
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(`${__cliPkg.name} v${__cliPkg.version}\n`);
  console.error(`Usage: ${__cliPkg.name} [options]\n`);
  console.error("MCP server communicating via stdio. Configure in your .mcp.json.\n");
  console.error("Options:");
  console.error("  --help, -h       Show this help message");
  console.error("  --version, -v    Show version number");
  console.error(`\nDocumentation: https://github.com/mharnett/mcp-ga4`);
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.error(__cliPkg.version);
  process.exit(0);
}

// Startup: detect npx vs direct node
if (process.argv[1]?.includes('.npm/_npx')) {
  console.error("[startup] Running via npx -- first run may be slow due to package resolution");
}

// Startup: check heap size
const heapLimit = v8.getHeapStatistics().heap_size_limit;
if (heapLimit < 256 * 1024 * 1024) {
  console.error(`[startup] WARNING: Heap limit is ${Math.round(heapLimit / 1024 / 1024)}MB`);
}

// ============================================
// ENV VAR TRIMMING
// ============================================

const envTrimmed = (key: string): string => (process.env[key] || "").trim().replace(/^["']|["']$/g, "");

// ============================================
// CONFIGURATION
// ============================================

interface ClientConfig {
  name: string;
  folder: string;
  property_id: string;
  sandbox_measurement_id?: string;
  production_measurement_id?: string;
}

interface Config {
  credentials_file: string;
  clients: Record<string, ClientConfig>;
}

function loadConfig(): Config {
  // Single-property mode via env vars
  const propertyId = envTrimmed("GA4_PROPERTY_ID");
  const rawCredsFile = envTrimmed("GOOGLE_APPLICATION_CREDENTIALS");
  // Resolve relative credential paths to absolute (CWD is unpredictable in MCP hosts)
  const credsFile = rawCredsFile && !isAbsolute(rawCredsFile) ? resolve(rawCredsFile) : rawCredsFile;

  if (propertyId) {
    return {
      credentials_file: credsFile,
      clients: {
        default: {
          name: process.env.GA4_PROPERTY_NAME || "My Property",
          folder: "",
          property_id: propertyId,
        },
      },
    };
  }

  // Multi-client mode via config.json
  const searchPaths = [
    process.env.MCP_GA4_CONFIG,
    join(homedir(), ".config", "mcp-ga4", "config.json"),
    join(dirname(new URL(import.meta.url).pathname), "..", "config.json"),
  ].filter(Boolean) as string[];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      const clients: Record<string, ClientConfig> = {};
      for (const [key, c] of Object.entries(raw.clients || {})) {
        const cc = c as any;
        clients[key] = {
          name: cc.name,
          folder: cc.folder,
          property_id: cc.property_id,
          sandbox_measurement_id: cc.sandbox_measurement_id,
          production_measurement_id: cc.production_measurement_id,
        };
      }
      return {
        credentials_file: raw.credentials_file || credsFile,
        clients,
      };
    }
  }

  throw new Error(
    "No GA4 configuration found. Either:\n" +
    "  1. Set GA4_PROPERTY_ID and GOOGLE_APPLICATION_CREDENTIALS env vars, or\n" +
    "  2. Create ~/.config/mcp-ga4/config.json (see config.example.json)"
  );
}

function getClientFromWorkingDir(config: Config, cwd: string): ClientConfig | null {
  // Single-property mode
  if (Object.keys(config.clients).length === 1 && "default" in config.clients) {
    return config.clients.default;
  }
  for (const [key, client] of Object.entries(config.clients)) {
    if (cwd.startsWith(client.folder) || cwd.includes(key)) {
      return client;
    }
  }
  return null;
}

// ============================================
// GA4 API MANAGER
// ============================================

class Ga4Manager {
  private config: Config;
  private dataClient: InstanceType<typeof BetaAnalyticsDataClient> | null = null;
  private adminClient: InstanceType<typeof AnalyticsAdminServiceClient> | null = null;

  constructor(config: Config) {
    this.config = config;

    if (!config.credentials_file && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error("[STARTUP WARNING] No credentials file configured");
    }
  }

  private getAuth(): GoogleAuth {
    return new GoogleAuth({
      keyFile: this.config.credentials_file || undefined,
      scopes: [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/analytics.edit",
      ],
    });
  }

  private getDataClient(): InstanceType<typeof BetaAnalyticsDataClient> {
    if (!this.dataClient) {
      const opts: any = {};
      if (this.config.credentials_file) {
        opts.keyFile = this.config.credentials_file;
      }
      opts.scopes = ["https://www.googleapis.com/auth/analytics.readonly"];
      this.dataClient = new BetaAnalyticsDataClient(opts);
    }
    return this.dataClient;
  }

  private getAdminClient(): InstanceType<typeof AnalyticsAdminServiceClient> {
    if (!this.adminClient) {
      const opts: any = {};
      if (this.config.credentials_file) {
        opts.keyFile = this.config.credentials_file;
      }
      opts.scopes = [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/analytics.edit",
      ];
      this.adminClient = new AnalyticsAdminServiceClient(opts);
    }
    return this.adminClient;
  }

  private responseToRows(response: any): Record<string, string>[] {
    const rows: Record<string, string>[] = [];
    for (const row of response.rows || []) {
      const r: Record<string, string> = {};
      for (let i = 0; i < (response.dimensionHeaders || []).length; i++) {
        r[response.dimensionHeaders[i].name] = row.dimensionValues[i].value;
      }
      for (let i = 0; i < (response.metricHeaders || []).length; i++) {
        r[response.metricHeaders[i].name] = row.metricValues[i].value;
      }
      rows.push(r);
    }
    return rows;
  }

  // ── Reports ──

  async runReport(propertyId: string, options: {
    dimensions?: string;
    metrics?: string;
    startDate?: string;
    endDate?: string;
    dimensionFilter?: string;
    limit?: number;
    orderBy?: string;
  }): Promise<any> {
    const client = this.getDataClient();
    const dims = (options.dimensions || "eventName").split(",").map(d => ({ name: d.trim() })).filter(d => d.name);
    const mets = (options.metrics || "eventCount").split(",").map(m => ({ name: m.trim() })).filter(m => m.name);
    const startDate = options.startDate || "7daysAgo";
    const endDate = options.endDate || "today";

    // Future date validation (skip relative dates like "7daysAgo")
    const today_ga4 = new Date().toISOString().slice(0, 10);
    if (startDate && !startDate.includes("daysAgo") && !startDate.includes("yesterday") && !startDate.includes("today") && startDate > today_ga4) {
      return { rows: [], row_count: 0, error: `start_date "${startDate}" is in the future. Reports only cover historical data.` };
    }

    // Cap limit at 10,000 for sanity (GA4 API max is 100,000)
    const limit = Math.min(options.limit || 100, 10000);

    const request: any = {
      property: `properties/${propertyId}`,
      dimensions: dims,
      metrics: mets,
      dateRanges: [{ startDate, endDate }],
      limit,
    };

    if (options.dimensionFilter && options.dimensionFilter.includes("==")) {
      const [field, value] = options.dimensionFilter.split("==", 2);
      request.dimensionFilter = {
        filter: {
          fieldName: field.trim(),
          stringFilter: { value: value.trim() },
        },
      };
    }

    if (options.orderBy) {
      request.orderBys = [{
        metric: { metricName: options.orderBy },
        desc: true,
      }];
    }

    return withResilience(async () => {
      const [response] = await client.runReport(request);
      const rows = this.responseToRows(response);
      return {
        rows,
        row_count: rows.length,
        date_range: `${startDate} to ${endDate}`,
      };
    }, "ga4_run_report");
  }

  async realtimeReport(propertyId: string, options: {
    dimensions?: string;
    metrics?: string;
    dimensionFilter?: string;
  }): Promise<any> {
    const client = this.getDataClient();
    const dims = (options.dimensions || "eventName").split(",").map(d => ({ name: d.trim() })).filter(d => d.name);
    const mets = (options.metrics || "eventCount").split(",").map(m => ({ name: m.trim() })).filter(m => m.name);

    const request: any = {
      property: `properties/${propertyId}`,
      dimensions: dims,
      metrics: mets,
    };

    if (options.dimensionFilter && options.dimensionFilter.includes("==")) {
      const [field, value] = options.dimensionFilter.split("==", 2);
      request.dimensionFilter = {
        filter: {
          fieldName: field.trim(),
          stringFilter: { value: value.trim() },
        },
      };
    }

    return withResilience(async () => {
      const [response] = await client.runRealtimeReport(request);
      const rows = this.responseToRows(response);
      return { rows, row_count: rows.length };
    }, "ga4_realtime_report");
  }

  // ── Admin ──

  async listCustomDimensions(propertyId: string): Promise<any> {
    const client = this.getAdminClient();
    return withResilience(async () => {
      const [dims] = await client.listCustomDimensions({ parent: `properties/${propertyId}` });
      const items = (dims as any[]).map((d: any) => ({
        name: d.displayName,
        parameter_name: d.parameterName,
        scope: String(d.scope),
        description: d.description || "",
      }));
      return { custom_dimensions: items, count: items.length };
    }, "ga4_list_custom_dimensions");
  }

  async createCustomDimension(propertyId: string, options: {
    parameterName: string;
    displayName: string;
    scope?: string;
    description?: string;
  }): Promise<any> {
    const client = this.getAdminClient();
    const scopeValue = options.scope?.toUpperCase() === "USER" ? "USER" : "EVENT";

    return withResilience(async () => {
      const [result] = await client.createCustomDimension({
        parent: `properties/${propertyId}`,
        customDimension: {
          parameterName: options.parameterName,
          displayName: options.displayName,
          scope: scopeValue as any,
          description: options.description || "",
        },
      });
      return {
        created: (result as any).displayName,
        parameter_name: (result as any).parameterName,
        scope: String((result as any).scope),
      };
    }, "ga4_create_custom_dimension");
  }

  async listCustomMetrics(propertyId: string): Promise<any> {
    const client = this.getAdminClient();
    return withResilience(async () => {
      const [metrics] = await client.listCustomMetrics({ parent: `properties/${propertyId}` });
      const items = (metrics as any[]).map((m: any) => ({
        name: m.displayName,
        parameter_name: m.parameterName,
        scope: String(m.scope),
        measurement_unit: String(m.measurementUnit),
        description: m.description || "",
      }));
      return { custom_metrics: items, count: items.length };
    }, "ga4_list_custom_metrics");
  }

  async listDataStreams(propertyId: string): Promise<any> {
    const client = this.getAdminClient();
    return withResilience(async () => {
      const [streams] = await client.listDataStreams({ parent: `properties/${propertyId}` });
      const items = (streams as any[]).map((s: any) => {
        const stream: any = { name: s.displayName, type: String(s.type) };
        if (s.webStreamData) {
          stream.measurement_id = s.webStreamData.measurementId;
          stream.default_uri = s.webStreamData.defaultUri;
        }
        return stream;
      });
      return { data_streams: items, count: items.length };
    }, "ga4_list_data_streams");
  }

  // ── Feedback (local file logging) ──

  saveFeedback(entry: Record<string, string>): void {
    const dir = join(homedir(), ".config", "mcp-ga4", "feedback");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "feedback.jsonl"), JSON.stringify(entry) + "\n");
  }

  saveImprovement(entry: Record<string, string>): void {
    const dir = join(homedir(), ".config", "mcp-ga4", "feedback");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "improvements.jsonl"), JSON.stringify(entry) + "\n");
  }
}

// ============================================
// MCP SERVER
// ============================================

const config = loadConfig();
const ga4Manager = new Ga4Manager(config);

const GA4_INSTRUCTIONS = `GA4 Analytics MCP - Query Google Analytics 4 data using natural language.

## Quick Start
1. Call ga4_get_client_context first to confirm which property you're connected to.
2. Use ga4_run_report for historical data or ga4_realtime_report for live data.

## Common Dimension & Metric API Names
Dimensions: date, dateHour, eventName, pagePath, pageTitle, sessionSource,
  sessionMedium, sessionCampaignName, country, city, deviceCategory,
  browser, operatingSystem, landingPage, pageReferrer, newVsReturning
Metrics: sessions, totalUsers, newUsers, activeUsers, screenPageViews,
  eventCount, conversions, engagedSessions, engagementRate,
  averageSessionDuration, bounceRate, sessionsPerUser

## Date Formats
Use YYYY-MM-DD or relative: "today", "yesterday", "7daysAgo", "30daysAgo", "90daysAgo"`;

const server = new Server(
  { name: __cliPkg.name, version: __cliPkg.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const ok = (data: any) => ({
    content: [{ type: "text" as const, text: JSON.stringify(safeResponse(data, name), null, 2) }],
  });

  try {
    switch (name) {
      case "ga4_get_client_context": {
        const cwd = args?.working_directory as string;
        const client = getClientFromWorkingDir(config, cwd);
        if (!client) {
          return ok({
            error: "No client found for working directory",
            working_directory: cwd,
            available_clients: Object.entries(config.clients).map(([k, v]) => ({
              key: k, name: v.name, folder: v.folder,
            })),
          });
        }
        return ok({
          client_name: client.name,
          property_id: client.property_id,
          folder: client.folder,
          sandbox_measurement_id: client.sandbox_measurement_id || null,
          production_measurement_id: client.production_measurement_id || null,
        });
      }

      case "ga4_run_report":
        return ok(await ga4Manager.runReport(args?.property_id as string, {
          dimensions: args?.dimensions as string,
          metrics: args?.metrics as string,
          startDate: args?.start_date as string,
          endDate: args?.end_date as string,
          dimensionFilter: args?.dimension_filter as string,
          limit: args?.limit as number,
          orderBy: args?.order_by as string,
        }));

      case "ga4_realtime_report":
        return ok(await ga4Manager.realtimeReport(args?.property_id as string, {
          dimensions: args?.dimensions as string,
          metrics: args?.metrics as string,
          dimensionFilter: args?.dimension_filter as string,
        }));

      case "ga4_list_custom_dimensions":
        return ok(await ga4Manager.listCustomDimensions(args?.property_id as string));

      case "ga4_create_custom_dimension":
        return ok(await ga4Manager.createCustomDimension(args?.property_id as string, {
          parameterName: args?.parameter_name as string,
          displayName: args?.display_name as string,
          scope: args?.scope as string,
          description: args?.description as string,
        }));

      case "ga4_list_custom_metrics":
        return ok(await ga4Manager.listCustomMetrics(args?.property_id as string));

      case "ga4_list_data_streams":
        return ok(await ga4Manager.listDataStreams(args?.property_id as string));

      case "ga4_send_feedback": {
        const feedbackType = args?.feedback_type as string;
        if (!["bug", "feature", "question"].includes(feedbackType)) {
          return ok({ error: "feedback_type must be: bug, feature, or question" });
        }
        ga4Manager.saveFeedback({
          type: feedbackType,
          message: args?.message as string,
          query_context: (args?.query_context as string) || "",
          timestamp: new Date().toISOString(),
        });
        return ok({ status: "recorded", feedback_type: feedbackType });
      }

      case "ga4_suggest_improvement": {
        ga4Manager.saveImprovement({
          type: "improvement",
          failed_query: args?.failed_query as string,
          expected_result: args?.expected_result as string,
          actual_result: (args?.actual_result as string) || "",
          timestamp: new Date().toISOString(),
        });
        return ok({ status: "recorded", message: "Query pattern logged for improvement." });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (rawError: any) {
    const error = classifyError(rawError);
    logger.error({ error_type: error.name, message: error.message }, "Tool call failed");

    const response: Record<string, unknown> = {
      error: true,
      error_type: error.name,
      message: error.message,
      server: __cliPkg.name,
    };

    if (error instanceof Ga4AuthError) {
      response.action_required = "Check service account or OAuth credentials and GA4 property access.";
    } else if (error instanceof Ga4RateLimitError) {
      response.retry_after_ms = error.retryAfterMs;
      response.action_required = `Rate limited. Retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds.`;
    } else if (error instanceof Ga4ServiceError) {
      response.action_required = "GA4 API server error. This is transient - retry in a few minutes.";
    } else {
      response.details = rawError.stack;
    }

    // Size-limit error responses through safeResponse to prevent oversized payloads
    const safeErrorResponse = safeResponse(response, "error");
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(safeErrorResponse, null, 2) }],
    };
  }
});

async function main() {
  // Startup health check - try listing data streams for the first configured property
  try {
    const firstClient = Object.values(config.clients)[0];
    if (firstClient) {
      await ga4Manager.listDataStreams(firstClient.property_id);
      console.error(`[startup] Auth verified: GA4 property ${firstClient.property_id} (${firstClient.name})`);
    }
  } catch (err: any) {
    console.error(`[STARTUP WARNING] Auth check FAILED: ${err.message}`);
    console.error(`[STARTUP WARNING] MCP will start but API calls may fail until auth is fixed.`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[startup] MCP GA4 server running");
}

process.on("SIGTERM", () => {
  console.error("[shutdown] SIGTERM received, exiting");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[shutdown] SIGINT received, exiting");
  process.exit(0);
});

process.on("SIGPIPE", () => {
  // Client disconnected -- expected during shutdown
});

process.on("unhandledRejection", (reason) => {
  console.error("[error] Unhandled promise rejection:", reason);
});

main().catch(console.error);
