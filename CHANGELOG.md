# Changelog

## [2.1.0](https://github.com/mharnett/mcp-ga4/compare/v2.0.0...v2.1.0) (2026-07-09)


### Features

* **oauth:** publishable PKCE + dual OAuth/service-account decouple ([#8](https://github.com/mharnett/mcp-ga4/issues/8)) ([49d448a](https://github.com/mharnett/mcp-ga4/commit/49d448adbc835610dadd2fb435481568bea5dfa9))


### Bug Fixes

* add --repo flag to gh issue/label commands to avoid git context requirement ([a068832](https://github.com/mharnett/mcp-ga4/commit/a068832bd51a21ba70b8adfa86b6fa46058407ea))
* budget validation, GAQL mutation blocking, future date checks, limit caps ([365ccaf](https://github.com/mharnett/mcp-ga4/commit/365ccaf3a16489b06b19dd972ba314103de94615))
* **ci:** regenerate lockfile for registry mcp-updatenotifier + sync row_count on truncation ([#6](https://github.com/mharnett/mcp-ga4/issues/6)) ([93cccd3](https://github.com/mharnett/mcp-ga4/commit/93cccd3ff6c5fee230813cb4d1adaa32892fed25))
* **critical:** use TimeoutStrategy.Aggressive to actually abort hung requests ([667d3b4](https://github.com/mharnett/mcp-ga4/commit/667d3b4e1d40f5c62fcd329c676a7210111dba4a))
* depend on mcp-updatenotifier from the registry (^1.0.0) ([#5](https://github.com/mharnett/mcp-ga4/issues/5)) ([a9edb1b](https://github.com/mharnett/mcp-ga4/commit/a9edb1b3fe5a43c5d72bc0b6467a73fc35de1417))
* error server prefix, isError consistency, validateCredentials, CHANGELOG ([c294c67](https://github.com/mharnett/mcp-ga4/commit/c294c67e56e4f076c1d9cbf05ebca965e95f3441))
* error size limits, safeResponse mutation, CHANGELOG, security warnings ([3bd9339](https://github.com/mharnett/mcp-ga4/commit/3bd93391295c007b4bb99a41feeaff56819191be))
* ID validation, path resolution, health tools, descriptions ([0a22160](https://github.com/mharnett/mcp-ga4/commit/0a2216045d1f604910ec874b9088d917566a803d))
* move mcp-test-harness checkout inside workspace root ([#2](https://github.com/mharnett/mcp-ga4/issues/2)) ([3af384d](https://github.com/mharnett/mcp-ga4/commit/3af384d717e14eabeb21dcde7b8cd0fac014c641))
* Node 18.18 minimum, env var trimming, unhandledRejection, TTY guard ([dc01d5b](https://github.com/mharnett/mcp-ga4/commit/dc01d5b96ab2f852ff7f219e68f100986cdfc720))
* README accuracy, env var docs, dependency cleanup ([2bb300b](https://github.com/mharnett/mcp-ga4/commit/2bb300ba193b90163ed91e410dbeae34b7f36103))
* remove mcp-ga4-setup bin entry that has no source ([e437542](https://github.com/mharnett/mcp-ga4/commit/e43754284eaa07e2578052119bb8168482778eba))
* **resilience:** tie row_count update to the rows key, not any array sibling ([#7](https://github.com/mharnett/mcp-ga4/issues/7)) ([92db8bf](https://github.com/mharnett/mcp-ga4/commit/92db8bfbc923ba4d38ea5d22dd85d71ea6af0746))
* resolve import and export issues from cascade failure ([052d0bb](https://github.com/mharnett/mcp-ga4/commit/052d0bb9c46cc9648494ac20ffd0909e079d1196))
* startup checks, credential redaction, schema hardening, format validation ([5b5fb2c](https://github.com/mharnett/mcp-ga4/commit/5b5fb2ca0d1ec1267d9507c00fff553fd0895789))
* stderr logging, Linux/Docker compat, SIGPIPE, version fallback ([9f7d432](https://github.com/mharnett/mcp-ga4/commit/9f7d4323cd846b8387590063c702dae5fdb13c5b))
* version field, safeResponse loop, auth retry, SIGTERM handling ([29cbd4f](https://github.com/mharnett/mcp-ga4/commit/29cbd4f8e5efacad40226ea29ca34acd3f80bc8b))

## [2.0.15] - 2026-04-18

### Added
- **Startup npm outdated check.** At server boot, fires a fire-and-forget
  HTTP request to `registry.npmjs.org/mcp-ga4/latest` (2s timeout) and logs
  a stderr notice when a newer version is available. stdout stays reserved
  for MCP JSON-RPC. Silent on network error, timeout, or when installed
  matches registry. Opt out with `MCP_DISABLE_UPDATE_CHECK=1`.

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
