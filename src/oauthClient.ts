// ============================================
// Auth-mode selection (pure) + runtime OAuth2 client construction.
// ============================================
// ga4 supports TWO credential families, published:
//
//   1. Service account / keyfile (RECOMMENDED for unattended/server use) --
//      the user points GOOGLE_APPLICATION_CREDENTIALS (env) or config.json
//      `credentials_file` at a JSON keyfile. That keyfile may be a real
//      service-account key OR an `authorized_user` OAuth token dump -- both are
//      accepted by GoogleAuth via the `keyFile` option (do NOT reject
//      authorized_user). The service account must be granted access on the GA4
//      property. No env refresh token is involved.
//
//   2. User-OAuth -- the user runs `get-refresh-token.cjs`, which mints a
//      refresh token against their OWN Google OAuth client. The runtime reads
//      GA4_CLIENT_ID / GA4_CLIENT_SECRET / GA4_REFRESH_TOKEN from env and drives
//      the GA4 SDKs with an OAuth2 client. Best for personal/interactive use.
//
// Selection is DETERMINISTIC and config-time -- an explicit keyfile/SA wins,
// then user-OAuth, else a loud onboarding error. There is NO machine-local
// default keyfile and NO silent runtime failover: a later 403 surfaces as the
// API error, not as a silent switch to another credential family.

import { OAuth2Client } from "google-auth-library";

export type AuthMode =
  | { mode: "oauth"; clientId: string; clientSecret: string; refreshToken: string }
  | { mode: "service_account"; keyFile: string }
  | { mode: "none" };

/** A resolved, usable auth mode -- `none` never escapes resolveAuthMode(). */
export type ResolvedAuthMode = Exclude<AuthMode, { mode: "none" }>;

/** Trim + strip surrounding quotes from an env value; "" if absent. */
function envVal(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] || "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Decide which credential family to use, purely from env.
 *
 * Precedence (keyfile/SA-FIRST): an explicit service-account keyfile
 * (GOOGLE_APPLICATION_CREDENTIALS) wins -- it is the recommended, deterministic
 * signal for unattended/server installs. Otherwise a full user-OAuth triple
 * (GA4_CLIENT_ID + GA4_CLIENT_SECRET + GA4_REFRESH_TOKEN) selects the OAuth
 * family. If neither is configured, `none`.
 *
 * A partial OAuth set (e.g. client id + secret but no refresh token) does NOT
 * select OAuth -- it falls through to `none` so the user gets a clear
 * onboarding error rather than a silent half-config.
 */
export function selectAuthMode(env: NodeJS.ProcessEnv): AuthMode {
  const keyFile = envVal(env, "GOOGLE_APPLICATION_CREDENTIALS");
  if (keyFile) {
    return { mode: "service_account", keyFile };
  }

  const clientId = envVal(env, "GA4_CLIENT_ID");
  const clientSecret = envVal(env, "GA4_CLIENT_SECRET");
  const refreshToken = envVal(env, "GA4_REFRESH_TOKEN");
  if (clientId && clientSecret && refreshToken) {
    return { mode: "oauth", clientId, clientSecret, refreshToken };
  }

  return { mode: "none" };
}

/** Clear onboarding error naming BOTH credential options. */
export const GA4_NO_CREDENTIALS_MESSAGE =
  "No GA4 credentials configured. Choose ONE (keyfile/service account takes precedence when both are set):\n" +
  "  1. Service account (RECOMMENDED for unattended/server use): set " +
  "GOOGLE_APPLICATION_CREDENTIALS (or config.json `credentials_file`) to a JSON " +
  "keyfile whose service account is granted access on the GA4 property.\n" +
  "  2. User OAuth (personal/interactive use): set GA4_CLIENT_ID, GA4_CLIENT_SECRET, " +
  "and GA4_REFRESH_TOKEN (run `npm run auth` / get-refresh-token.cjs to mint the refresh token).";

/**
 * Reconcile env + an optional config.json `credentials_file` into a single
 * usable AuthMode -- keyfile/SA-FIRST, then user-OAuth, else a LOUD error.
 *
 * Precedence, config-time and deterministic (NOT runtime failover):
 *   1. Explicit keyfile -- from GOOGLE_APPLICATION_CREDENTIALS (env) OR the
 *      config.json `credentials_file` argument. Either outranks a user-OAuth
 *      triple, even when both are present. When BOTH keyfile sources are set,
 *      the ENV keyfile wins over config.json (12-factor: env overrides the
 *      committed config without editing files).
 *   2. User-OAuth triple (GA4_CLIENT_ID + GA4_CLIENT_SECRET + GA4_REFRESH_TOKEN).
 *   3. Neither -> throw GA4_NO_CREDENTIALS_MESSAGE. Never a silent machine-local
 *      default; a later API 403 surfaces as the API error, not a credential swap.
 */
export function resolveAuthMode(
  env: NodeJS.ProcessEnv,
  configCredentialsFile?: string,
): ResolvedAuthMode {
  const envMode = selectAuthMode(env);

  // 1. Keyfile / service account first. Env keyfile (captured by selectAuthMode)
  //    wins over a config.json credentials_file when both are set (12-factor:
  //    env overrides committed config); either outranks OAuth.
  const keyFile =
    (envMode.mode === "service_account" ? envMode.keyFile : "") ||
    (configCredentialsFile || "").trim();
  if (keyFile) {
    return { mode: "service_account", keyFile };
  }

  // 2. User-OAuth triple.
  if (envMode.mode === "oauth") {
    return envMode;
  }

  // 3. Nothing configured -- fail loudly, name both options.
  throw new Error(GA4_NO_CREDENTIALS_MESSAGE);
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
