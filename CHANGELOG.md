# Changelog

## [2.0.14] - 2026-04-17

### Fixed
- **Logger wrote to stdout under Claude Desktop, corrupting the MCP JSON-RPC
  stream.** The local fix (`pino.destination(2)` passed unconditionally as the
  second arg) had been applied to `src/resilience.ts` but never made it into a
  published release; v2.0.13 and earlier shipped the TTY-gated version that
  silently fell back to stdout in non-TTY subprocesses. Claude Desktop rejected
  every frame with an `unrecognized_keys: level, time, pid, hostname, msg`
  schema error. Published builds now match local source. 2.0.13 is deprecated
  on npm.

## [2.0.10] - 2026-04-04

### Security
- Error responses now pass through `safeResponse` to prevent oversized error payloads
- `safeResponse` deep-clones before truncation to avoid mutating original data

## [2.0.6] - 2026-04-09

### Added
- Rewritten from Python to TypeScript
- CLI flags (--help, --version)
- SIGTERM/SIGINT graceful shutdown
- Env var trimming and validation

### Security
- All logging to stderr (stdout reserved for MCP protocol)
- Auth errors not retried (fail fast on 401/403)
