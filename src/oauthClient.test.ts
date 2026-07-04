// ============================================
// Auth-mode selection (OAuth vs service-account vs none) -- pure logic.
// ============================================
// This is the branch that decides which credential family the runtime uses.
// It must be deterministic from env alone, with user-OAuth taking precedence,
// SA next, and a clean `none` (no hidden /Users/mark keyfile default) when
// nothing is configured.

import { describe, it, expect } from "vitest";
import { selectAuthMode, buildOAuth2Client } from "./oauthClient.js";

describe("selectAuthMode", () => {
  it("selects OAuth when the full client_id/secret/refresh_token triple is present", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "oauth", clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
  });

  it("OAuth wins over a service-account keyfile when both are set (primary path)", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
      GOOGLE_APPLICATION_CREDENTIALS: "/some/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m.mode).toBe("oauth");
  });

  it("selects service_account when only GOOGLE_APPLICATION_CREDENTIALS is set", () => {
    const m = selectAuthMode({
      GOOGLE_APPLICATION_CREDENTIALS: "/some/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "service_account", keyFile: "/some/sa.json" });
  });

  it("a PARTIAL OAuth set (no refresh token) does NOT select OAuth -> falls through", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
    } as NodeJS.ProcessEnv);
    expect(m.mode).toBe("none");
  });

  it("a partial OAuth set with an SA keyfile falls through to service_account", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GOOGLE_APPLICATION_CREDENTIALS: "/some/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m.mode).toBe("service_account");
  });

  it("returns `none` when nothing is configured (NO machine-local keyfile default)", () => {
    expect(selectAuthMode({} as NodeJS.ProcessEnv)).toEqual({ mode: "none" });
  });

  it("trims surrounding quotes/whitespace from env values", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: '"cid"',
      GA4_CLIENT_SECRET: " sec ",
      GA4_REFRESH_TOKEN: "'rt'",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "oauth", clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
  });
});

describe("buildOAuth2Client", () => {
  it("constructs an OAuth2Client carrying the refresh token", () => {
    const client = buildOAuth2Client({ clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
    expect(client.credentials.refresh_token).toBe("rt");
  });
});
