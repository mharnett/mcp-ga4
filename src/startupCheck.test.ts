/**
 * The startup auth check runs beside the server and its failure reaches the
 * client on the first tool call (startupCheck.ts). Nothing here makes a call:
 * the checks are test functions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartupCheck } from "./startupCheck.js";

const okResult = () => ({ content: [{ type: "text" as const, text: JSON.stringify({ rows: [] }) }] });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("StartupCheck", () => {
  it("adds nothing when the check passed", async () => {
    const check = new StartupCheck();
    await check.run(async () => {});
    expect(check.annotate(okResult())).toEqual(okResult());
  });

  it("adds nothing when no check was started", () => {
    expect(new StartupCheck().annotate(okResult())).toEqual(okResult());
  });

  it("reports a failure on the first result only, after the tool's own content", async () => {
    const check = new StartupCheck();
    await check.run(async () => {
      throw new Error("invalid_grant");
    });

    const first = check.annotate(okResult());
    expect(first.content[0]).toEqual(okResult().content[0]);
    expect(first.content).toHaveLength(2);
    expect(JSON.parse(first.content[1].text)).toMatchObject({ startup_check: "failed", message: "invalid_grant" });

    expect(check.annotate(okResult())).toEqual(okResult());
  });

  it("keeps isError on the result it annotates", async () => {
    const check = new StartupCheck();
    await check.run(async () => {
      throw new Error("down");
    });
    const result = check.annotate({ ...okResult(), isError: true });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(2);
  });

  it("a check that is still running adds nothing; its later failure is reported on the next call", async () => {
    const check = new StartupCheck();
    let fail!: (err: Error) => void;
    const running = check.run(() => new Promise<void>((_, reject) => (fail = reject)));

    expect(check.annotate(okResult())).toEqual(okResult());

    fail(new Error("Operation timed out after 30000ms"));
    await running;
    expect(check.annotate(okResult()).content).toHaveLength(2);
  });

  it("never rejects: a throwing check, a rejecting one and a non-Error are all just failures", async () => {
    for (const bad of [
      () => {
        throw new Error("sync");
      },
      async () => {
        throw new Error("async");
      },
      () => Promise.reject("a string"),
    ]) {
      const check = new StartupCheck();
      await expect(check.run(bad as () => Promise<void>)).resolves.toBeUndefined();
      expect(check.annotate(okResult()).content).toHaveLength(2);
    }
  });

  it("caps a long message", async () => {
    const check = new StartupCheck();
    await check.run(async () => {
      throw new Error("x".repeat(5_000));
    });
    expect(JSON.parse(check.annotate(okResult()).content[1].text).message.length).toBeLessThanOrEqual(500);
  });

  it("does not change the result object it was given", async () => {
    const check = new StartupCheck();
    await check.run(async () => {
      throw new Error("down");
    });
    const given = okResult();
    check.annotate(given);
    expect(given).toEqual(okResult());
  });
});
