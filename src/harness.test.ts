import { registerMcpTests } from "@drak-marketing/mcp-test-harness";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerMcpTests({
  name: "mcp-ga4",
  repoRoot: path.resolve(__dirname, ".."),
  toolPrefix: "ga4_",
  minTools: 5,
  requiredTools: ["ga4_get_client_context", "ga4_run_report"],
  binEntries: {
    "mcp-ga4": "dist/index.js",
  },
  hasAuthCli: false,
  hasCredentials: false,
  hasResilience: false,
  hasPlatform: false,
  requiredEnvVars: [],
  envPrefix: "GA4_",
  // Fakes only. The server needs a property id plus one credential set (the
  // user-OAuth trio or a service account), or it exits at loadConfig. Its
  // background auth check calls the GA4 Admin API; it is skipped here so the
  // harness has no calls to refuse (startupCheck.spawn.test.ts covers it).
  startupEnv: {
    GA4_PROPERTY_ID: "123456789",
    GA4_CLIENT_ID: "fake-ga4-client-id",
    GA4_CLIENT_SECRET: "fake-ga4-client-secret",
    GA4_REFRESH_TOKEN: "fake-ga4-refresh-token",
    MCP_GA4_SKIP_STARTUP_CHECK: "1",
  },
  sourceLintIgnore: ["setup.ts", "index.ts"],
});
