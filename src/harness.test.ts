import { registerMcpTests } from "@drak/mcp-test-harness";
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
  sourceLintIgnore: ["setup.ts", "index.ts"],
});
