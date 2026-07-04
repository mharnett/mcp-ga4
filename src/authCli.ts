#!/usr/bin/env node
// ============================================
// Runtime OAuth onboarding CLI (PKCE) -- `npm run auth`.
// ============================================
// A second, in-tree onboarding path alongside the standalone
// get-refresh-token.cjs helper. Both:
//   - request scopes from config.json oauth.scope (src/oauthScope.ts),
//   - use PKCE (S256) on Google's installed-app loopback flow (src/pkce.ts),
//   - register ONE canonical loopback redirect form http://localhost/callback.
// A cross-drift test (pkce-parity / scope-parity) asserts the helper and this
// runtime never diverge.

import http from "http";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  generateCodeVerifier,
  computeCodeChallenge,
  buildLoopbackRedirectUri,
} from "./pkce.js";
import { loadOAuthScopeFromFile, DEFAULT_GA4_SCOPE } from "./oauthScope.js";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Require both client creds from an env-like object; throw a clear error otherwise. */
export function requireClientCreds(env: NodeJS.ProcessEnv): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = (env.GA4_CLIENT_ID || "").trim();
  const clientSecret = (env.GA4_CLIENT_SECRET || "").trim();
  const missing: string[] = [];
  if (!clientId) missing.push("GA4_CLIENT_ID");
  if (!clientSecret) missing.push("GA4_CLIENT_SECRET");
  if (missing.length) {
    throw new Error(
      `Missing required env var(s): ${missing.join(", ")}.\n` +
        `Create a "Desktop app" OAuth client at https://console.cloud.google.com/apis/credentials, ` +
        `then export GA4_CLIENT_ID and GA4_CLIENT_SECRET.`,
    );
  }
  return { clientId, clientSecret };
}

/** Resolve scope from THIS install's config.json (repo root), else the default. */
export function loadScope(): string {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  return loadOAuthScopeFromFile(join(repoRoot, "config.json"));
}

export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: args.scope,
    access_type: "offline", // REQUIRED for Google to return a refresh_token
    prompt: "consent", // force a refresh_token even on re-consent
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export function buildTokenExchangeParams(args: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier, // PKCE proof -- sent on exchange
  }).toString();
}

// ── Live flow (guarded behind main; not exercised by unit tests) ─────────────

async function run(): Promise<void> {
  const { clientId, clientSecret } = requireClientCreds(process.env);
  const scope = loadScope();
  const port = Number(process.env.OAUTH_CALLBACK_PORT || 8123);
  const redirectUri = buildLoopbackRedirectUri(port);

  const state = randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const authUrl = buildAuthUrl({ clientId, redirectUri, scope, state, codeChallenge });

  const code: string = await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, redirectUri);
      const err = url.searchParams.get("error");
      const returnedCode = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Authorization denied</h1><p>You can close this tab.</p>");
        done(() => {
          server.close();
          reject(new Error(`OAuth denied: ${err}`));
        });
        return;
      }
      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>State mismatch</h1><p>Possible CSRF. Re-run the command.</p>");
        done(() => {
          server.close();
          reject(new Error("OAuth state mismatch -- possible CSRF"));
        });
        return;
      }
      if (!returnedCode) {
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Signed in</h1><p>You can close this tab and return to the terminal.</p>");
      done(() => {
        setTimeout(() => server.close(), 200);
        resolve(returnedCode);
      });
    });
    server.on("error", (e: Error) =>
      done(() => reject(new Error(`Loopback server failed: ${e.message}`))),
    );
    server.listen(port, "127.0.0.1", async () => {
      process.stderr.write(`\nCallback server listening on ${redirectUri}\n`);
      process.stderr.write("Opening your browser to sign in with Google...\n");
      process.stderr.write(`If it doesn't open, visit:\n  ${authUrl}\n\n`);
      try {
        // `open` is an optional convenience dep (not required to run auth). Use
        // a computed specifier so tsc doesn't hard-require its types, and fall
        // back gracefully to printing the URL if it isn't installed.
        const openSpecifier = "open";
        const openMod: any = await import(openSpecifier).catch(() => null);
        if (openMod) await (openMod.default || openMod)(authUrl);
        else process.stderr.write("Could not open a browser automatically; paste the URL above.\n");
      } catch {
        process.stderr.write("Could not open a browser automatically; paste the URL above.\n");
      }
    });
    setTimeout(
      () =>
        done(() => {
          server.close();
          reject(new Error("Timed out waiting for OAuth callback (5 minutes)."));
        }),
      5 * 60 * 1000,
    );
  });

  process.stderr.write("Authorization code received. Exchanging for tokens...\n");
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: buildTokenExchangeParams({ code, clientId, clientSecret, redirectUri, codeVerifier }),
  });
  const data: any = await resp.json();

  if (!data.refresh_token) {
    process.stderr.write(
      "No refresh_token returned. If you previously granted consent, revoke it at " +
        "https://myaccount.google.com/permissions and re-run.\n",
    );
    process.exit(1);
  }

  // The refresh token is the intended output; it goes to STDOUT so it can be
  // captured. Nothing else sensitive is printed. Do NOT run this with stdout
  // redirected to a shared log.
  process.stdout.write(`GA4_REFRESH_TOKEN=${data.refresh_token}\n`);
  process.stderr.write("\nDone. Set the line above in your environment.\n");
  process.exit(0);
}

// Only run when invoked directly, not when imported by tests.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  run().catch((err: Error) => {
    process.stderr.write(`\nError: ${err.message}\n`);
    process.exit(1);
  });
}

export { DEFAULT_GA4_SCOPE };
