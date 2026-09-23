import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverCode } from "../src/discovery.js";

async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "pijev-discovery-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "src"));
  return cwd;
}

test("natural language finds split identifiers in actual code beyond file headers", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "src", "a.ts"), "export const version = 1;\n");
  const source = [...Array.from({ length: 90 }, (_, i) => `const value${i} = ${i};`), "export function refreshSessionToken() {", "  return session_token;", "}"].join("\n");
  await writeFile(join(cwd, "src", "z.ts"), source);
  const result = await discoverCode({ cwd, query: "Where does the session token refresh happen?" });
  assert.ok(result.candidates.length > 0);
  const first = result.candidates[0]!;
  assert.equal(first.path, "src/z.ts");
  assert.equal(first.line, 91);
  assert.ok(first.excerpt.includes("export function refreshSessionToken()"));
  assert.ok(source.split("\n").slice(first.startLine - 1).join("\n").startsWith(first.excerpt));
  assert.equal(result.filesScanned, 2);
});

test("Chinese terms match existing comments without translation and changed files are reread", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "src", "a.ts"), "export const settings = {};\n");
  const file = join(cwd, "src", "z.ts");
  await writeFile(file, "// 请求取消后移除等待队列\nexport function cancelRequest() {}\n");
  const first = await discoverCode({ cwd, query: "请求取消后如何移除等待队列" });
  assert.equal(first.candidates[0]?.path, "src/z.ts");
  assert.match(first.candidates[0]!.excerpt, /请求取消/);
  await writeFile(file, "export function completelyChanged() {}\n");
  const second = await discoverCode({ cwd, query: "completely changed" });
  assert.match(second.candidates[0]!.excerpt, /completelyChanged/);
  assert.ok(second.candidates.every((item) => !item.excerpt.includes("请求取消")));
});

test("discovery preserves exclusions, ignores, glob narrowing and realpath boundaries", async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, ".git"));
  await writeFile(join(cwd, ".gitignore"), "ignored/\n");
  await writeFile(join(cwd, "src", "safe.ts"), "export function refreshToken() {}\n");
  for (const dir of [".private", "node_modules", "vendor", "dist", "build", "coverage", "ignored"]) {
    await mkdir(join(cwd, dir));
    await writeFile(join(cwd, dir, "private.ts"), "refreshToken secret\n");
  }
  for (const file of [".env", "credentials.json", "prod.env", "private.key", "private.pem", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
    await writeFile(join(cwd, file), "refreshToken secret\n");
  }
  await symlink(join(cwd, ".private"), join(cwd, "hidden-alias"));
  await symlink(join(cwd, "ignored"), join(cwd, "ignored-alias"));
  await symlink(tmpdir(), join(cwd, "outside"));
  const config = join(cwd, ".rg-config");
  await writeFile(config, "--hidden\n--no-ignore\n--follow\n");
  const previous = process.env.RIPGREP_CONFIG_PATH;
  process.env.RIPGREP_CONFIG_PATH = config;
  t.after(() => { if (previous === undefined) delete process.env.RIPGREP_CONFIG_PATH; else process.env.RIPGREP_CONFIG_PATH = previous; });
  for (const glob of ["*", "**/*", "*.ts"]) {
    const result = await discoverCode({ cwd, query: "refresh token", glob });
    assert.deepEqual(result.candidates.map((item) => item.path), ["src/safe.ts"]);
  }
  for (const path of [".private", "hidden-alias", "dist", "credentials.json"]) {
    await assert.rejects(discoverCode({ cwd, query: "refresh", path }), /excludes|directory|symlink/i);
  }
  for (const path of ["../", "outside"]) await assert.rejects(discoverCode({ cwd, query: "refresh", path }), /inside|symlink/i);
  assert.deepEqual((await discoverCode({ cwd, query: "refresh", path: "ignored" })).candidates, []);
  assert.deepEqual((await discoverCode({ cwd, query: "refresh", path: "ignored-alias" })).candidates, []);
  assert.deepEqual((await discoverCode({ cwd, query: "refresh", glob: "*.py" })).candidates, []);
});

test("candidates cover diverse files deterministically instead of the alphabetical prefix", async (t) => {
  const cwd = await fixture(t);
  for (let i = 0; i < 140; i++) await writeFile(join(cwd, "src", `file${String(i).padStart(3, "0")}.ts`), `export function processRequest${i}() {\n  return ${i};\n}\n`);
  const result = await discoverCode({ cwd, query: "request processing" });
  // One candidate per file: ranking decides which file to read, not which window.
  assert.equal(result.candidates.length, 50);
  assert.equal(new Set(result.candidates.map((item) => item.path)).size, 50);
  assert.ok(result.candidates.some((item) => Number(item.path.match(/file(\d+)/)![1]) >= 100));
  assert.deepEqual(await discoverCode({ cwd, query: "request processing" }), result);
  assert.equal(result.truncated, true);
});

test("zero lexical overlap yields bounded real implementation windows, including below headers", async (t) => {
  const cwd = await fixture(t);
  const source = ["// Copyright Example", ...Array.from({ length: 120 }, (_, i) => `export function calculate${i}() { return ${i}; }`)].join("\n");
  await writeFile(join(cwd, "src", "math.ts"), source);
  const result = await discoverCode({ cwd, query: "用户等待取消后应该如何处理" });
  assert.ok(result.candidates.length > 0 && result.candidates.length <= 32);
  assert.ok(result.candidates.some((item) => item.startLine > 40));
  for (const item of result.candidates) assert.ok(source.split("\n").slice(item.startLine - 1).join("\n").startsWith(item.excerpt));
  assert.equal(result.truncated, true);
});

test("long lines and UTF-8 excerpts stay within payload bounds and expose clipping", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "src", "large.ts"), `export const 请求 = '${"等待队列".repeat(3000)}';\nexport const tail = true;\n`);
  const result = await discoverCode({ cwd, query: "请求等待队列" });
  assert.ok(result.candidates.length > 0);
  assert.equal(result.truncated, true);
  assert.ok(result.candidates.every((item) => Buffer.byteLength(item.excerpt) <= 1800));
  assert.ok(result.candidates.every((item) => !item.excerpt.includes("�")));
  assert.ok(result.candidates.reduce((sum, item) => sum + Buffer.byteLength(item.excerpt), 0) <= 32 * 1800);
});

test("a clipped long line never joins later lines into fabricated evidence", async (t) => {
  const cwd = await fixture(t);
  const source = `request${"文".repeat(800)}\n\nexport const tail = true;\n`;
  await writeFile(join(cwd, "src", "long.ts"), source);
  const result = await discoverCode({ cwd, query: "request" });
  assert.ok(result.candidates.length > 0);
  for (const item of result.candidates) assert.ok(source.split("\n").slice(item.startLine - 1).join("\n").startsWith(item.excerpt));
});

test("every candidate stays individually bounded even when source escaping expands it", async (t) => {
  const cwd = await fixture(t);
  for (let i = 0; i < 40; i++) await writeFile(join(cwd, "src", `f${i}.ts`), `// request ${"\\".repeat(2000)}`);
  const result = await discoverCode({ cwd, query: "request" });
  assert.ok(result.candidates.length > 0);
  // The shortlist no longer fits one request, so the per-candidate bounds are
  // what keep batching in DecisionEngine.rankCode predictable.
  assert.ok(result.candidates.every((item) => Buffer.byteLength(item.excerpt) <= 1800));
  assert.ok(result.candidates.every((item) => Buffer.byteLength(item.outline!) <= 1200));
  assert.ok(result.candidates.every((item) => !item.outline!.includes("\uFFFD")));
  assert.equal(result.truncated, true);
});

test("binary and oversized files are not offered as source evidence", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "src", "binary.ts"), Buffer.from("request\0private binary"));
  await writeFile(join(cwd, "src", "oversized.ts"), "request".repeat(40_000));
  await writeFile(join(cwd, "src", "safe.ts"), "export const request = true;\n");
  const result = await discoverCode({ cwd, query: "request" });
  assert.deepEqual(result.candidates.map((item) => item.path), ["src/safe.ts"]);
  assert.equal(result.truncated, true);
});

test("enumeration and aggregate reads stop at their bounds with explicit truncation", async (t) => {
  const cwd = await fixture(t);
  await Promise.all(Array.from({ length: 1002 }, (_, i) => writeFile(join(cwd, "src", `f${i}.ts`), "export const value = true;\n")));
  const many = await discoverCode({ cwd, query: "value", maxFiles: 1000 });
  assert.ok(many.filesScanned <= 1000);
  assert.ok(many.candidates.length <= 50);
  assert.equal(many.truncated, true);
  // Without a caller cap the same tree is fully enumerated, so the shortlist is
  // the only thing discarding files.
  const all = await discoverCode({ cwd, query: "value" });
  assert.equal(all.filesScanned, 1002);
  assert.equal(all.candidates.length, 50);
  await rm(join(cwd, "src"), { recursive: true });
  await mkdir(join(cwd, "src"));
  const content = "export const value = true;\n" + "// filler\n".repeat(26_211);
  assert.ok(Buffer.byteLength(content) <= 262_144);
  await Promise.all(Array.from({ length: 22 }, (_, i) => writeFile(join(cwd, "src", `f${i}.ts`), content)));
  const large = await discoverCode({ cwd, query: "value", maxReadBytes: 4 * 1024 * 1024 });
  assert.ok(large.filesScanned <= 17);
  assert.equal(large.truncated, true);
});

test("invalid input is rejected, option-like text is data, and cancellation works", async (t) => {
  const cwd = await fixture(t);
  for (const query of ["", "  ", "bad\0query", "x".repeat(2001)]) await assert.rejects(discoverCode({ cwd, query }), /query/i);
  for (const path of ["bad\0path", "bad\npath"]) await assert.rejects(discoverCode({ cwd, query: "value", path }), /path/i);
  for (const glob of ["bad\0glob", "x".repeat(501)]) await assert.rejects(discoverCode({ cwd, query: "value", glob }), /glob/i);
  assert.deepEqual((await discoverCode({ cwd, query: "--help; $(touch injected)" })).candidates, []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(discoverCode({ cwd, query: "value", signal: controller.signal }), /abort/i);
});

test("running rg is terminated on cancellation and also has a deadline", async (t) => {
  const cwd = await fixture(t);
  const bin = join(cwd, "bin");
  await mkdir(bin);
  const fake = join(bin, "rg");
  // A subprocess double is necessary to exercise a genuinely hung executable.
  await writeFile(fake, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
  await chmod(fake, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}:${previous}`;
  t.after(() => { if (previous === undefined) delete process.env.PATH; else process.env.PATH = previous; });
  const controller = new AbortController();
  const cancelled = discoverCode({ cwd, query: "value", signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 50);
  await assert.rejects(cancelled, /abort/i);
  clearTimeout(timer);
  const start = Date.now();
  await assert.rejects(discoverCode({ cwd, query: "value" }), /timed out/i);
  assert.ok(Date.now() - start < 7000);
});
