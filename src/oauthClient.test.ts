// ============================================
// Auth-mode selection (service-account/keyfile vs OAuth vs none) -- pure logic.
// ============================================
// This is the branch that decides which credential family the runtime uses.
// It must be a DETERMINISTIC, config-time selection (NOT runtime failover):
// an explicit keyfile / service account takes precedence, user-OAuth is next,
// and when NOTHING is configured the resolver raises a loud onboarding error
// (never a hidden /Users/mark keyfile or silent ADC default).

import { describe, it, expect } from "vitest";
import { selectAuthMode, buildOAuth2Client, resolveAuthMode } from "./oauthClient.js";

describe("selectAuthMode (pure, env only)", () => {
  it("selects service_account when only GOOGLE_APPLICATION_CREDENTIALS is set", () => {
    const m = selectAuthMode({
      GOOGLE_APPLICATION_CREDENTIALS: "/some/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "service_account", keyFile: "/some/sa.json" });
  });

  it("selects OAuth when the full client_id/secret/refresh_token triple is present (and no keyfile)", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "oauth", clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
  });

  it("KEYFILE wins over an OAuth triple when BOTH are set (keyfile/SA-first precedence)", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
      GOOGLE_APPLICATION_CREDENTIALS: "/some/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "service_account", keyFile: "/some/sa.json" });
  });

  it("a PARTIAL OAuth set (no refresh token) does NOT select OAuth -> falls through to none", () => {
    const m = selectAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
    } as NodeJS.ProcessEnv);
    expect(m.mode).toBe("none");
  });

  it("a partial OAuth set with an SA keyfile selects service_account", () => {
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

describe("resolveAuthMode (env + config.json credentials_file, loud on none)", () => {
  it("(a) BOTH an env keyfile and an OAuth triple -> selects KEYFILE (precedence)", () => {
    const m = resolveAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
      GOOGLE_APPLICATION_CREDENTIALS: "/env/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "service_account", keyFile: "/env/sa.json" });
  });

  it("a config.json credentials_file outranks an env OAuth triple (keyfile/SA-first)", () => {
    const m = resolveAuthMode(
      {
        GA4_CLIENT_ID: "cid",
        GA4_CLIENT_SECRET: "sec",
        GA4_REFRESH_TOKEN: "rt",
      } as NodeJS.ProcessEnv,
      "/config/sa.json",
    );
    expect(m).toEqual({ mode: "service_account", keyFile: "/config/sa.json" });
  });

  it("(b) only an OAuth triple (no keyfile anywhere) -> selects OAuth", () => {
    const m = resolveAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "oauth", clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
  });

  it("(c) only an env keyfile -> selects service_account", () => {
    const m = resolveAuthMode({
      GOOGLE_APPLICATION_CREDENTIALS: "/env/sa.json",
    } as NodeJS.ProcessEnv);
    expect(m).toEqual({ mode: "service_account", keyFile: "/env/sa.json" });
  });

  it("(d) neither -> throws a loud onboarding error naming BOTH options", () => {
    expect(() => resolveAuthMode({} as NodeJS.ProcessEnv)).toThrow();
    let msg = "";
    try {
      resolveAuthMode({} as NodeJS.ProcessEnv);
    } catch (e) {
      msg = (e as Error).message;
    }
    // Must name the service-account path AND the user-OAuth path.
    expect(msg).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
    expect(msg).toMatch(/GA4_CLIENT_ID/);
    expect(msg).toMatch(/GA4_REFRESH_TOKEN/);
    // Must not silently fall back to a machine-local default.
    expect(msg.toLowerCase()).not.toContain("/users/");
  });

  it("never returns { mode: 'none' } -- resolution is loud, not silent", () => {
    // Any resolved value is a usable mode; the `none` sentinel never escapes.
    const oauth = resolveAuthMode({
      GA4_CLIENT_ID: "cid",
      GA4_CLIENT_SECRET: "sec",
      GA4_REFRESH_TOKEN: "rt",
    } as NodeJS.ProcessEnv);
    expect(oauth.mode).not.toBe("none");
  });
});

describe("buildOAuth2Client", () => {
  it("constructs an OAuth2Client carrying the refresh token", () => {
    const client = buildOAuth2Client({ clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
    expect(client.credentials.refresh_token).toBe("rt");
  });
});
