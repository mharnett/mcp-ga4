#!/usr/bin/env bash
# Per-repo wrapper. Delegates to canonical MCP smoke test.
# This MCP requires env from ~/.claude.json mcpServers.ga4.env
set -e
cd "$(dirname "$0")/.."
exec /Users/mark/claude-code/mcps/scripts/mcp-smoke.sh --mcp ga4 /Users/mark/claude-code/mcps/mcp-ga4/run-mcp.sh
