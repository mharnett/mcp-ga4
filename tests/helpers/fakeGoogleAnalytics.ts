/**
 * Recording stand-ins for the GA4 Data and Admin API clients, so tests can
 * drive src/index.ts in-process without gRPC, OAuth or Google.
 *
 * Wire them in with vi.mock("@google-analytics/data") and
 * vi.mock("@google-analytics/admin") (see writeGate.callSite.test.ts). Every
 * client construction and method call lands in `recorder`; a test sets
 * `recorder.fail` to make every call reject.
 */

export const FAKE_PROPERTY_ID = "999000111";

export const FAKE_ENV: Record<string, string> = {
  GA4_PROPERTY_ID: FAKE_PROPERTY_ID,
  GA4_CLIENT_ID: "fake-client-id-0001",
  GA4_CLIENT_SECRET: "fake-client-secret-0001",
  GA4_REFRESH_TOKEN: "fake-refresh-token-0001",
  MCP_GA4_CONFIG: "/nonexistent/mcp-ga4-test-config.json",
};

export interface RecordedCall {
  client: "data" | "admin";
  method: string;
  request: any;
}

export const recorder = {
  calls: [] as RecordedCall[],
  constructed: 0,
  fail: null as null | (() => Error),
  reset() {
    this.calls.length = 0;
    this.constructed = 0;
    this.fail = null;
  },
  callsTo(method: string) {
    return this.calls.filter((c) => c.method === method);
  },
};

function record(client: RecordedCall["client"], method: string, request: any, response: unknown) {
  recorder.calls.push({ client, method, request });
  if (recorder.fail) return Promise.reject(recorder.fail());
  return Promise.resolve([response]);
}

export class FakeBetaAnalyticsDataClient {
  constructor(_opts?: unknown) {
    recorder.constructed += 1;
  }
  runReport(request: any) {
    return record("data", "runReport", request, { rows: [], dimensionHeaders: [], metricHeaders: [] });
  }
  runRealtimeReport(request: any) {
    return record("data", "runRealtimeReport", request, { rows: [], dimensionHeaders: [], metricHeaders: [] });
  }
}

export class FakeAnalyticsAdminServiceClient {
  constructor(_opts?: unknown) {
    recorder.constructed += 1;
  }
  listCustomDimensions(request: any) {
    return record("admin", "listCustomDimensions", request, []);
  }
  listCustomMetrics(request: any) {
    return record("admin", "listCustomMetrics", request, []);
  }
  listDataStreams(request: any) {
    return record("admin", "listDataStreams", request, []);
  }
  createCustomDimension(request: any) {
    return record("admin", "createCustomDimension", request, {
      displayName: request.customDimension.displayName,
      parameterName: request.customDimension.parameterName,
      scope: request.customDimension.scope,
    });
  }
}
