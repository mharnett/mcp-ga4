# Backlog

## BUG: server hangs on `ga4_run_report` with `property_id="undefined"`

**Severity:** medium
**Surfaced by:** 2026-05-21 test audit (`mcps/mcp-marketing-suite/test/chaos.test.ts:1340-1373`)
**Symptom:** when `ga4_run_report` is invoked with `property_id` literal string `"undefined"`, the server fails to emit a JSON-RPC response within 6 seconds.
**Why it's now visible:** a chaos test previously wrapped its assertion in `if (toolResponse) { ... }`, silently passing when no response came back. That conditional was removed during the Forcepoint-rubric audit, so the test now fails loud.
**Expected behavior:** validate `property_id` shape at entry, return a structured error response immediately, do not hang.
**Repro:** run the relevant chaos case in `mcp-marketing-suite/test/chaos.test.ts` — it is the canary.
