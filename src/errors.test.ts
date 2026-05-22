import { describe, it, expect } from "vitest";
import { Ga4AuthError, Ga4RateLimitError, Ga4ServiceError, Ga4InvalidArgumentError, classifyError, requireStringArg } from "./errors.js";

describe("classifyError", () => {
  it("classifies PERMISSION_DENIED as auth error", () => {
    expect(classifyError(new Error("PERMISSION_DENIED: caller lacks access"))).toBeInstanceOf(Ga4AuthError);
  });

  it("classifies gRPC code 7 (PERMISSION_DENIED) as auth error", () => {
    expect(classifyError({ message: "no access", code: 7 })).toBeInstanceOf(Ga4AuthError);
  });

  it("classifies gRPC code 16 (UNAUTHENTICATED) as auth error", () => {
    expect(classifyError({ message: "bad token", code: 16 })).toBeInstanceOf(Ga4AuthError);
  });

  it("classifies 429 as rate limit error", () => {
    const err = classifyError({ message: "Too many requests", code: 429 });
    expect(err).toBeInstanceOf(Ga4RateLimitError);
    expect((err as Ga4RateLimitError).retryAfterMs).toBe(60_000);
  });

  it("classifies gRPC code 8 (RESOURCE_EXHAUSTED) as rate limit error", () => {
    expect(classifyError({ message: "quota", code: 8 })).toBeInstanceOf(Ga4RateLimitError);
  });

  it("classifies 500 as service error", () => {
    expect(classifyError({ message: "Internal", code: 500 })).toBeInstanceOf(Ga4ServiceError);
  });

  it("classifies gRPC code 13 (INTERNAL) as service error", () => {
    expect(classifyError({ message: "internal", code: 13 })).toBeInstanceOf(Ga4ServiceError);
  });

  it("returns original error for unrecognized", () => {
    const orig = new Error("something else");
    expect(classifyError(orig)).toBe(orig);
  });
});

describe("requireStringArg", () => {
  it("returns the value when valid", () => {
    expect(requireStringArg("property_id", "331956119")).toBe("331956119");
  });

  it("rejects undefined", () => {
    expect(() => requireStringArg("property_id", undefined)).toThrow(Ga4InvalidArgumentError);
  });

  it("rejects null", () => {
    expect(() => requireStringArg("property_id", null)).toThrow(Ga4InvalidArgumentError);
  });

  it("rejects empty string", () => {
    expect(() => requireStringArg("property_id", "")).toThrow(Ga4InvalidArgumentError);
  });

  it("rejects whitespace-only string", () => {
    expect(() => requireStringArg("property_id", "   ")).toThrow(Ga4InvalidArgumentError);
  });

  it('rejects literal "undefined" sentinel (the canary bug)', () => {
    try {
      requireStringArg("property_id", "undefined");
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(Ga4InvalidArgumentError);
      expect(e.argName).toBe("property_id");
      expect(e.reason).toContain("sentinel");
    }
  });

  it('rejects literal "null" sentinel', () => {
    expect(() => requireStringArg("property_id", "null")).toThrow(Ga4InvalidArgumentError);
  });

  it("rejects non-string types (number)", () => {
    expect(() => requireStringArg("property_id", 12345)).toThrow(/expected string, got number/);
  });

  it("rejects non-string types (object)", () => {
    expect(() => requireStringArg("property_id", { foo: "bar" })).toThrow(/expected string, got object/);
  });

  it("rejects non-string types (boolean)", () => {
    expect(() => requireStringArg("property_id", true)).toThrow(/expected string, got boolean/);
  });

  it("accepts strings with surrounding whitespace (does not auto-trim caller's value)", () => {
    // Trim is only used to detect empty/sentinel; the actual value is returned untouched
    // so downstream APIs see exactly what the caller sent. If trimming becomes needed,
    // do it at the call site, not here.
    expect(requireStringArg("property_id", " 331956119 ")).toBe(" 331956119 ");
  });
});
