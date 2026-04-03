import { describe, it, expect } from "vitest";
import { Ga4AuthError, Ga4RateLimitError, Ga4ServiceError, classifyError } from "./errors.js";

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
