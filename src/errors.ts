export class Ga4AuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "Ga4AuthError";
  }
}

export class Ga4RateLimitError extends Error {
  constructor(public readonly retryAfterMs: number, cause?: unknown) {
    super(`GA4 rate limited, retry after ${retryAfterMs}ms`);
    this.name = "Ga4RateLimitError";
    this.cause = cause;
  }
}

export class Ga4ServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "Ga4ServiceError";
  }
}

/**
 * Thrown when a required tool argument is missing, the wrong type, or carries
 * a sentinel "undefined"/"null" string. Surfaced as a structured error envelope
 * so callers see "InvalidArgumentError" + which arg failed, instead of the
 * server hanging on a downstream API call with a malformed property_id.
 */
export class Ga4InvalidArgumentError extends Error {
  constructor(public readonly argName: string, public readonly reason: string) {
    super(`Invalid argument '${argName}': ${reason}`);
    this.name = "Ga4InvalidArgumentError";
  }
}

/**
 * Validate that a tool argument is a non-empty string and not the literal
 * "undefined" / "null" sentinels that LLM clients sometimes send.
 * Throws Ga4InvalidArgumentError, caught by the dispatch envelope.
 */
export function requireStringArg(name: string, value: unknown): string {
  if (value === undefined || value === null) {
    throw new Ga4InvalidArgumentError(name, "missing required argument");
  }
  if (typeof value !== "string") {
    throw new Ga4InvalidArgumentError(name, `expected string, got ${typeof value}`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Ga4InvalidArgumentError(name, "empty string");
  }
  if (trimmed === "undefined" || trimmed === "null") {
    throw new Ga4InvalidArgumentError(name, `literal sentinel '${trimmed}' is not a valid value`);
  }
  return value;
}

export function validateCredentials(): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.GA4_PROPERTY_ID?.trim()) missing.push("GA4_PROPERTY_ID");
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) missing.push("GOOGLE_APPLICATION_CREDENTIALS");
  // Basic format validation: credentials should have reasonable length > 5 chars
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().length > 0 && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim().length < 5) {
    missing.push("GOOGLE_APPLICATION_CREDENTIALS (format: path too short, expected length > 5)");
  }
  return { valid: missing.length === 0, missing };
}

export function classifyError(error: any): Error {
  const message = error?.message || String(error);
  const code = error?.code || error?.status;
  // Check response body for error objects (gRPC/REST can return errors in body)
  const bodyError = error?.response?.body?.error || error?.data?.error || error?.errors?.[0];

  if (code === 401 || code === 403 || code === 7 || code === 16 ||
      message.includes("PERMISSION_DENIED") || message.includes("UNAUTHENTICATED") ||
      message.includes("invalid_grant") ||
      bodyError?.code === 7 || bodyError?.code === 16) {
    return new Ga4AuthError(`GA4 auth failed: ${message}. Check credentials.`, error);
  }

  if (code === 429 || code === 8 || message.includes("RESOURCE_EXHAUSTED") || message.includes("rateLimitExceeded")) {
    return new Ga4RateLimitError(60_000, error);
  }

  if (code >= 500 || code === 13 || code === 14 ||
      message.includes("INTERNAL") || message.includes("UNAVAILABLE")) {
    return new Ga4ServiceError(`GA4 API server error: ${message}`, error);
  }

  return error;
}
