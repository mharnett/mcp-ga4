// ============================================
// CI guard: the SHIPPED surface must contain no absolute /Users/mark path
// and no gcp-oauth (shared OAuth-client) reference.
// ============================================
// "Shipped surface" = exactly what npm publishes (package.json `files`) plus
// the standalone onboarding helper: get-refresh-token.cjs, src/** (excluding
// tests), README.md, config.example.json.
//
// The SHIPPED build output (dist/**/*.js, *.d.ts, and dist/build-info.json) is
// ALSO scanned: a forbidden string can be injected at build time and would evade
// a src-only guard. Compiled test files are excluded (they aren't shipped).
//
// Deliberately EXCLUDED: node_modules, .git, *.test.* / *.guard.* files, and
// Mark's PRIVATE launcher (run-mcp.sh) which is NOT in package.json `files` and
// therefore never ships. The guard asserts separately that it is not in the
// publish allowlist.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;

const FORBIDDEN = [/\/Users\/mark/, /gcp-oauth/];

// Directories never scanned by the source pass (dist scanned separately).
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "scripts", ".github", ".vitest"]);

function isTestOrGuard(file) {
  return /\.(test|guard)\.(m?[jt]s|cjs)$/.test(file);
}

// Walk only files that are part of the shipped surface.
function shippedFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(REPO, full);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      out.push(...shippedFiles(full));
      continue;
    }
    if (isTestOrGuard(entry)) continue;
    // config.json is gitignored/per-user -- not shipped; config.example.json is.
    if (entry === "config.json") continue;
    const shippable =
      full === path.join(REPO, "get-refresh-token.cjs") ||
      full === path.join(REPO, "README.md") ||
      full === path.join(REPO, "config.example.json") ||
      rel.startsWith("src" + path.sep);
    if (shippable) out.push(full);
  }
  return out;
}

// Walk the SHIPPED build output: dist/**/*.{js,d.ts} + dist/build-info.json,
// excluding compiled test files (not shipped per .npmignore **/*.test.js).
function shippedDistFiles(distDir) {
  if (!existsSync(distDir)) return [];
  const out = [];
  for (const entry of readdirSync(distDir)) {
    const full = path.join(distDir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...shippedDistFiles(full));
      continue;
    }
    if (/\.test\.(m?js|cjs)$/.test(entry) || /\.test\.d\.ts$/.test(entry)) continue;
    if (entry.endsWith(".js") || entry.endsWith(".d.ts") || entry === "build-info.json") {
      out.push(full);
    }
  }
  return out;
}

function scanForForbidden(files) {
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, "utf-8");
    src.split("\n").forEach((line, i) => {
      for (const re of FORBIDDEN) {
        if (re.test(line)) hits.push(`${path.relative(REPO, file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  return hits;
}

describe("shipped surface has no local /Users/mark paths or gcp-oauth references", () => {
  const files = shippedFiles(REPO);

  it("scans a non-trivial set of files (guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith("get-refresh-token.cjs"))).toBe(true);
    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
  });

  it("contains no forbidden string in any shipped source/doc file", () => {
    const hits = scanForForbidden(files);
    expect(hits, `Forbidden strings in shipped surface:\n${hits.join("\n")}`).toEqual([]);
  });

  it("contains no forbidden string in the SHIPPED build output (dist/**)", () => {
    const distFiles = shippedDistFiles(path.join(REPO, "dist"));
    expect(
      distFiles.some((f) => f.endsWith("build-info.json")),
      "dist not built (run `npm run build`) -- cannot verify shipped build output",
    ).toBe(true);
    const hits = scanForForbidden(distFiles);
    expect(hits, `Forbidden strings in shipped dist:\n${hits.join("\n")}`).toEqual([]);
  });

  it("private launcher scripts carrying /Users/mark are NOT in the npm publish allowlist", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf-8"));
    const allow = (pkg.files || []).join("\n");
    for (const priv of ["run-mcp.sh", "scripts/healthcheck.sh"]) {
      if (existsSync(path.join(REPO, priv))) {
        expect(allow).not.toContain(priv);
      }
    }
    // Belt-and-braces: no top-level *.sh is in the allowlist.
    expect(allow).not.toMatch(/\.sh(\s|$)/);
  });
});
