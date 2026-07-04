// ============================================
// OAuth scope resolution (single source of truth)
// ============================================
// The GA4 OAuth scope requested at auth time lives in config.json under
// `oauth.scope` (mirrors mcp-google-ads / mcp-linkedin-ads), so the standalone
// get-refresh-token.cjs helper and this runtime never drift on what they ask
// Google to grant.
//
// config.json is gitignored / per-user, so it may be absent (fresh clone,
// published package). In that case we fall back to the committed minimum scope.
// When config.json IS present with an oauth.scope, that value WINS -- that is
// how the helper and runtime stay in lockstep for a real deployment. The
// committed, editable config.example.json is NEVER read for scope resolution.

import { existsSync, readFileSync } from "fs";

/**
 * Minimum scope this MCP needs.
 *
 * ga4 ships a mutating tool -- `ga4_create_custom_dimension` calls the GA4
 * Admin API `createCustomDimension`, which requires `analytics.edit`. So the
 * committed default is readonly + edit (both). Everything else is read-only, but
 * because at least one tool writes, `analytics.edit` is a required grant and is
 * intentionally NOT dropped. A user who only wants read access can override
 * `oauth.scope` in their own config.json to `analytics.readonly` alone.
 */
export const DEFAULT_GA4_SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/analytics.edit";

/** Normalize a comma/space/newline-separated scope list to space-separated. */
export function normalizeScope(raw: string): string {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Resolve the OAuth scope from an already-parsed config object.
 * Falls back to DEFAULT_GA4_SCOPE when oauth.scope is absent/empty.
 */
export function resolveOAuthScope(config: unknown): string {
  const scope =
    config &&
    typeof config === "object" &&
    "oauth" in config &&
    (config as { oauth?: { scope?: unknown } }).oauth &&
    typeof (config as { oauth: { scope?: unknown } }).oauth.scope === "string"
      ? (config as { oauth: { scope: string } }).oauth.scope
      : "";
  const normalized = normalizeScope(scope);
  return normalized || DEFAULT_GA4_SCOPE;
}

/**
 * Read the OAuth scope from a config file on disk (config.json). Returns the
 * committed default if the file is missing or unparseable.
 */
export function loadOAuthScopeFromFile(filePath: string): string {
  if (!existsSync(filePath)) return DEFAULT_GA4_SCOPE;
  try {
    return resolveOAuthScope(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return DEFAULT_GA4_SCOPE;
  }
}
