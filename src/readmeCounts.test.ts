import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tools } from "./tools.js";
import { filterTools } from "./writeGate.js";

const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");

describe("README tool counts match what the server registers", () => {
  it("states the total number of tools", () => {
    expect(readme).toContain(`${tools.length} tools`);
  });

  it("states how many are listed by default, with the write gate closed", () => {
    const byDefault = filterTools(tools, {}).length;
    expect(byDefault).toBeLessThan(tools.length);
    expect(readme).toContain(`${byDefault} by default`);
  });

  it("names the env var that exposes the write tool", () => {
    expect(readme).toContain("GA4_MCP_WRITE=true");
  });

  it("lists every registered tool in the Tools table", () => {
    for (const t of tools) expect(readme).toContain(`\`${t.name}\``);
  });
});
