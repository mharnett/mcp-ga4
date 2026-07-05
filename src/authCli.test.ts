// ============================================
// Runtime OAuth CLI (src/authCli.ts) -- pure onboarding surface.
// ============================================
// Locks the runtime auth-URL construction (PKCE challenge + S256 + canonical
// redirect + config scope + offline/consent) and the env-missing error. Importing
// this module must NOT trigger the live loopback flow (invokedDirectly guard).

import { describe, it, expect } from "vitest";
import {
  buildAuthUrl,
  buildTokenExchangeParams,
  requireClientCreds,
  AUTH_URL,
} from "./authCli.js";
import { buildLoopbackRedirectUri } from "./pkce.js";

describe("authCli buildAuthUrl", () => {
  const scope = "https://www.googleapis.com/auth/analytics.readonly";
  const parsed = new URL(
    buildAuthUrl({
      clientId: "cid",
      redirectUri: buildLoopbackRedirectUri(8123),
      scope,
      state: "state123",
      codeChallenge: "CH",
    }),
  );

  it("targets Google's auth endpoint", () => {
    expect(`${parsed.origin}${parsed.pathname}`).toBe(AUTH_URL);
  });
  it("carries the PKCE challenge + S256", () => {
    expect(parsed.searchParams.get("code_challenge")).toBe("CH");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("carries the canonical loopback redirect", () => {
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:8123/callback");
  });
  it("carries the exact scope + offline/consent", () => {
    expect(parsed.searchParams.get("scope")).toBe(scope);
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });
});

describe("authCli token-exchange", () => {
  it("sends the PKCE code_verifier", () => {
    const p = new URLSearchParams(
      buildTokenExchangeParams({
        code: "c",
        clientId: "id",
        clientSecret: "s",
        redirectUri: "http://localhost:8123/callback",
        codeVerifier: "V",
      }),
    );
    expect(p.get("code_verifier")).toBe("V");
    expect(p.get("grant_type")).toBe("authorization_code");
  });
});

describe("authCli env validation", () => {
  it("throws naming missing GA4_CLIENT_ID / GA4_CLIENT_SECRET", () => {
    expect(() => requireClientCreds({} as NodeJS.ProcessEnv)).toThrowError(/GA4_CLIENT_ID/);
    expect(() => requireClientCreds({} as NodeJS.ProcessEnv)).toThrowError(/GA4_CLIENT_SECRET/);
  });
  it("returns creds when both present", () => {
    expect(
      requireClientCreds({ GA4_CLIENT_ID: "a", GA4_CLIENT_SECRET: "b" } as NodeJS.ProcessEnv),
    ).toEqual({ clientId: "a", clientSecret: "b" });
  });
});
