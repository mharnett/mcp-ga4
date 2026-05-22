# Backlog

_(Empty — see git history for resolved items.)_

## Resolved

### BUG: server hangs on `ga4_run_report` with `property_id="undefined"` — FIXED 2026-05-21

**Severity:** medium
**Surfaced by:** 2026-05-21 test audit (`mcps/mcp-marketing-suite/test/chaos.test.ts:1340-1373`)
**Symptom:** when `ga4_run_report` was invoked with `property_id` literal string `"undefined"`, the server failed to emit a JSON-RPC response within 6 seconds.
**Root cause:** dispatch in `src/index.ts` cast `args?.property_id as string` without validation; `tools.ts` declared the param required but dispatch didn't enforce it. A malformed property path then deadlocked the GA4 client.
**Fix:** added `requireStringArg()` in `src/errors.ts` that rejects `undefined`, `null`, empty/whitespace strings, the literal sentinels `"undefined"` and `"null"`, and non-string values. Wired into every dispatch case in `src/index.ts` for required params. New error class `Ga4InvalidArgumentError` is surfaced via the existing error envelope. Tests in `src/errors.test.ts` and `src/inputValidation.test.ts` exercise the canary case end-to-end.
