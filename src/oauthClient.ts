// ============================================
// Auth-mode selection (pure) + runtime OAuth2 client construction.
// ============================================
// ga4 supports TWO credential families, published:
//
//   1. User-OAuth  -- the user runs `get-refresh-token.cjs`, which mints a
//      refresh token against their OWN Google OAuth client. The runtime reads
//      GA4_CLIENT_ID / GA4_CLIENT_SECRET / GA4_REFRESH_TOKEN from env and drives
//      the GA4 SDKs with an OAuth2 client. This is the PRIMARY path (the
//      credential Mark's install actually uses is an `authorized_user` token
//      dump of exactly this shape).
//
//   2. Service account -- the user points GOOGLE_APPLICATION_CREDENTIALS at a
//      service-account JSON keyfile. The GA4 SDKs pick that up via Application
//      Default Credentials (ADC). No refresh token is involved.
//
// There is NO machine-local default keyfile path. If neither family is
// configured, selection returns `none` and the caller surfaces a clear error.

import { OAuth2Client } from "google-auth-library";

export type AuthMode =
  | { mode: "oauth"; clientId: string; clientSecret: string; refreshToken: string }
  | { mode: "service_account"; keyFile: string }
  | { mode: "none" };

/** Trim + strip surrounding quotes from an env value; "" if absent. */
function envVal(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] || "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Decide which credential family to use, purely from env.
 *
 * Precedence: user-OAuth wins when a full OAuth triple is present, because
 * that is ga4's primary path and the most explicit signal ("I minted a token
 * for this MCP"). Otherwise, a service-account keyfile path
 * (GOOGLE_APPLICATION_CREDENTIALS) selects the SA family. If neither is fully
 * configured, `none`.
 *
 * A partial OAuth set (e.g. client id + secret but no refresh token) does NOT
 * select OAuth -- it falls through to SA / none so the user gets a clear
 * "missing GA4_REFRESH_TOKEN" style error rather than a silent half-config.
 */
export function selectAuthMode(env: NodeJS.ProcessEnv): AuthMode {
  const clientId = envVal(env, "GA4_CLIENT_ID");
  const clientSecret = envVal(env, "GA4_CLIENT_SECRET");
  const refreshToken = envVal(env, "GA4_REFRESH_TOKEN");
  if (clientId && clientSecret && refreshToken) {
    return { mode: "oauth", clientId, clientSecret, refreshToken };
  }

  const keyFile = envVal(env, "GOOGLE_APPLICATION_CREDENTIALS");
  if (keyFile) {
    return { mode: "service_account", keyFile };
  }

  return { mode: "none" };
}

/**
 * Build a google-auth-library OAuth2Client from a resolved user-OAuth mode.
 */
export function buildOAuth2Client(auth: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): OAuth2Client {
  const client = new OAuth2Client(auth.clientId, auth.clientSecret);
  client.setCredentials({ refresh_token: auth.refreshToken });
  return client;
}

/** Constructor options handed to the GA4 SDK clients (data + admin). */
export interface Ga4ClientAuthOptions {
  /**
   * An explicit auth instance for the SDK. CRITICAL: the key MUST be `auth`,
   * not `authClient`. Both @google-analytics/data and @google-analytics/admin
   * default to the gRPC transport in Node, and google-gax's gRPC path reads
   * `options.auth || new GoogleAuth(options)` (google-gax grpc.js). It never
   * looks at `authClient` on that path -- so passing our OAuth2Client under
   * `authClient` is silently dropped and gax falls back to Application Default
   * Credentials, ignoring the user's refresh token entirely.
   */
  auth?: OAuth2Client;
  /** Service-account keyfile path (SA mode). */
  keyFile?: string;
}

/**
 * Translate a resolved AuthMode into the GA4 SDK constructor options.
 *   - oauth           -> { auth: OAuth2Client(refresh_token) }
 *   - service_account -> { keyFile }
 *   - none            -> {} (SDK falls back to ADC; a startup warning fires)
 *
 * `scopes` are added by the caller (SA/ADC needs them; OAuth ignores them).
 */
export function buildClientAuthOptions(authMode: AuthMode): Ga4ClientAuthOptions {
  if (authMode.mode === "oauth") {
    return { auth: buildOAuth2Client(authMode) };
  }
  if (authMode.mode === "service_account") {
    return { keyFile: authMode.keyFile };
  }
  return {};
}
