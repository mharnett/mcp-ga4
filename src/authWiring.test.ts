// ============================================
// SDK auth WIRING (composition) -- the OAuth2Client must actually be adopted.
// ============================================
// The unit tests prove buildOAuth2Client() and selectAuthMode() in isolation,
// but that is not enough: the bug this locks down is a COMPOSITION failure. Both
// @google-analytics/data and @google-analytics/admin default to the gRPC
// transport in Node, and google-gax's gRPC path reads `options.auth` (NOT
// `options.authClient`): grpc.js does `this.auth = options.auth || new
// GoogleAuth(options)`. So handing the OAuth2Client under the wrong key is
// silently dropped -- gax builds a fresh GoogleAuth and resolves via Application
// Default Credentials, ignoring the user's refresh token entirely. Auth "mode"
// logs as oauth while every call actually uses ADC.
//
// This test constructs the REAL SDK clients from buildClientAuthOptions() output
// and asserts the constructed client adopted OUR auth instance (a GoogleAuth
// wrapping our OAuth2Client), and that the client can build its gRPC stub.

import { describe, it, expect } from "vitest";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { AnalyticsAdminServiceClient } from "@google-analytics/admin";
import { OAuth2Client, GoogleAuth } from "google-auth-library";
import { buildClientAuthOptions, type AuthMode } from "./oauthClient.js";

const OAUTH_MODE: AuthMode = {
  mode: "oauth",
  clientId: "cid",
  clientSecret: "sec",
  refreshToken: "rt",
};

describe("OAuth mode is actually adopted by the GA4 SDK clients", () => {
  it("BetaAnalyticsDataClient.auth IS the GoogleAuth we passed (not a fresh ADC one)", () => {
    const opts = buildClientAuthOptions(OAUTH_MODE);
    // Precondition: the options must carry our auth under a key the gRPC path
    // reads. If this is the wrong key the SDK never sees it.
    expect(opts.auth).toBeInstanceOf(GoogleAuth);
    const passed = opts.auth;

    const client: any = new BetaAnalyticsDataClient({
      ...opts,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    // The resolved auth on the constructed client MUST be the very instance we
    // passed -- a fresh GoogleAuth built by gax would resolve via ADC instead.
    expect(client.auth).toBe(passed);
  });

  it("AnalyticsAdminServiceClient.auth IS the GoogleAuth we passed", () => {
    const opts = buildClientAuthOptions(OAUTH_MODE);
    const passed = opts.auth;
    const client: any = new AnalyticsAdminServiceClient({
      ...opts,
      scopes: [
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/analytics.edit",
      ],
    });
    expect(client.auth).toBe(passed);
  });

  it("the adopted auth resolves to an OAuth2Client carrying the user's refresh token", async () => {
    const opts = buildClientAuthOptions(OAUTH_MODE);
    const client: any = new BetaAnalyticsDataClient({
      ...opts,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const resolved: any = await client.auth.getClient();
    expect(resolved).toBeInstanceOf(OAuth2Client);
    expect(resolved.credentials.refresh_token).toBe("rt");
  });

  // Regression: constructing the client is not enough. google-gax 5 calls
  // `this.auth.getUniverseDomain()` when it builds the gRPC stub (first API
  // call / initialize()). A bare OAuth2Client has no getUniverseDomain(), so
  // every OAuth-mode call crashed with "this.auth.getUniverseDomain is not a
  // function" (2.3.1). initialize() builds the stub without touching the network.
  it("OAuth-mode BetaAnalyticsDataClient can build its gRPC stub", async () => {
    const client: any = new BetaAnalyticsDataClient({
      ...buildClientAuthOptions(OAUTH_MODE),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    await expect(client.initialize()).resolves.toBeDefined();
  });

  it("OAuth-mode AnalyticsAdminServiceClient can build its gRPC stub", async () => {
    const client: any = new AnalyticsAdminServiceClient({
      ...buildClientAuthOptions(OAUTH_MODE),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    await expect(client.initialize()).resolves.toBeDefined();
  });

  it("service_account mode still passes a keyFile (unchanged, no OAuth2Client)", () => {
    const opts = buildClientAuthOptions({ mode: "service_account", keyFile: "/some/sa.json" });
    expect(opts).toEqual({ keyFile: "/some/sa.json" });
    expect(opts.auth).toBeUndefined();
  });

  it("none mode passes no auth and no keyFile (unchanged; SDK falls back to ADC)", () => {
    const opts = buildClientAuthOptions({ mode: "none" });
    expect(opts).toEqual({});
  });
});
