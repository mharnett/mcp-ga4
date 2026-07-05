// ============================================
// Standalone helper (get-refresh-token.cjs) pure-unit tests.
// ============================================
// PKCE RFC 7636 vectors, verifier invariant, auth-URL construction (challenge +
// S256 + canonical redirect + config scope), token-exchange params, and the
// env-missing error. No network, no dist build required.

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helper = require("./get-refresh-token.cjs");

describe("helper PKCE (RFC 7636)", () => {
  it("computeCodeChallenge matches the RFC 7636 Appendix B test vector", () => {
    // RFC 7636 Appendix B: verifier -> challenge (S256).
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(helper.computeCodeChallenge(verifier)).toBe(expected);
  });

  it("base64url strips padding and is URL-safe", () => {
    const buf = Buffer.from([251, 239, 190, 0, 1, 2, 3, 255]);
    const out = helper.base64url(buf);
    expect(out).not.toMatch(/[+/=]/);
  });

  it("generateCodeVerifier satisfies the RFC length/charset invariant", () => {
    for (let i = 0; i < 20; i++) {
      const v = helper.generateCodeVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });
});

describe("helper auth URL", () => {
  const scope = "https://www.googleapis.com/auth/analytics.readonly";
  const url = helper.buildAuthUrl({
    clientId: "cid.apps.googleusercontent.com",
    redirectUri: helper.buildLoopbackRedirectUri(8123),
    scope,
    state: "abc123state",
    codeChallenge: "CHALLENGE_VALUE",
  });
  const parsed = new URL(url);

  it("targets Google's auth endpoint", () => {
    expect(`${parsed.origin}${parsed.pathname}`).toBe(helper.AUTH_URL);
  });
  it("carries the PKCE challenge and S256 method", () => {
    expect(parsed.searchParams.get("code_challenge")).toBe("CHALLENGE_VALUE");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("carries the canonical loopback redirect (host=localhost, path=/callback)", () => {
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:8123/callback");
  });
  it("carries the config-resolved scope exactly", () => {
    expect(parsed.searchParams.get("scope")).toBe(scope);
  });
  it("requests offline access + consent (required for a refresh_token)", () => {
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("response_type")).toBe("code");
  });
});

describe("helper token-exchange params", () => {
  it("includes the PKCE code_verifier and authorization_code grant", () => {
    const body = helper.buildTokenExchangeParams({
      code: "AUTHCODE",
      clientId: "cid",
      clientSecret: "secret",
      redirectUri: "http://localhost:8123/callback",
      codeVerifier: "VERIFIER",
    });
    const p = new URLSearchParams(body);
    expect(p.get("grant_type")).toBe("authorization_code");
    expect(p.get("code")).toBe("AUTHCODE");
    expect(p.get("code_verifier")).toBe("VERIFIER");
    expect(p.get("redirect_uri")).toBe("http://localhost:8123/callback");
  });
});

describe("helper env validation", () => {
  it("throws naming BOTH missing vars when neither is set", () => {
    expect(() => helper.requireClientCreds({})).toThrowError(/GA4_CLIENT_ID/);
    expect(() => helper.requireClientCreds({})).toThrowError(/GA4_CLIENT_SECRET/);
  });
  it("throws naming only the missing var", () => {
    expect(() => helper.requireClientCreds({ GA4_CLIENT_ID: "x" })).toThrowError(
      /GA4_CLIENT_SECRET/,
    );
    let msg = "";
    try {
      helper.requireClientCreds({ GA4_CLIENT_ID: "x" });
    } catch (e) {
      msg = e.message;
    }
    expect(msg).not.toMatch(/GA4_CLIENT_ID,/);
  });
  it("returns trimmed creds when both present", () => {
    expect(helper.requireClientCreds({ GA4_CLIENT_ID: " a ", GA4_CLIENT_SECRET: " b " })).toEqual({
      clientId: "a",
      clientSecret: "b",
    });
  });
});
