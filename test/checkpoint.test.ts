import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkpointSnapshot, changedSources, testCatalog, chooseCheckpointTests, runCheckpointTests } from "../eval/checkpoint.js";

async function workspace(t: test.TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "pijev-cp-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await Promise.all([mkdir(join(cwd, "src")), mkdir(join(cwd, "test")), mkdir(join(cwd, ".home")), mkdir(join(cwd, ".tmp"))]);
  return cwd;
}

test("checkpoint inspects source and named tests without following external symlinks", async (t) => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, "src/cache.ts"), "export const expiry = 20;\n");
  await writeFile(join(cwd, "test/cache.test.ts"), "import { expiry } from '../src/cache.js';\nimport test from 'node:test';\ntest('expires after completion', () => {});\n");
  await writeFile(join(cwd, "test/notes.txt"), "not a test");
  await symlink("/etc/passwd", join(cwd, "test/escape.test.ts"));
  const before = await checkpointSnapshot(cwd);
  assert.equal(before.has("test/escape.test.ts"), false);
  assert.equal(before.has("test/notes.txt"), false);
  await writeFile(join(cwd, "src/cache.ts"), "export const expiry = 30;\n");
  const changes = changedSources(before, await checkpointSnapshot(cwd));
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.path, "src/cache.ts");
  assert.match(changes[0]!.before, /20/);
  assert.match(changes[0]!.after, /30/);
  const catalog = testCatalog(before);
  assert.deepEqual(catalog.map((entry) => entry.path), ["test/cache.test.ts"]);
  assert.deepEqual(catalog[0]!.names, ["expires after completion"]);
  assert.ok(catalog[0]!.imports.includes("../src/cache.js"));
});

test("checkpoint baseline follows imports and Jev can select a semantically relevant alternative", async () => {
  const snapshot = new Map([
    ["src/cache.ts", "export const expiry = 20;"],
    ["src/index.ts", "export { expiry } from './cache.js';"],
    ["test/a.test.ts", "import '../src/cache.js'; test('cache smoke',()=>{});"],
    ["test/b.test.ts", "import '../src/index.js'; test('expiry preserves subscriber isolation',()=>{});"],
    ["test/c.test.ts", "test('other module',()=>{});"],
  ]);
  const changes = [{ path: "src/cache.ts", before: "export const expiry = 20;", after: "export const expiry = 30;", truncated: false }];
  const catalog = testCatalog(snapshot);
  const baseline = await chooseCheckpointTests({ mode: "dependencies", snapshot, changes, catalog, limit: 1 });
  assert.deepEqual(baseline.selected, ["test/a.test.ts"]);
  let called = 0;
  const semantic = await chooseCheckpointTests({ mode: "jev", snapshot, changes, catalog, limit: 1, provider: { evaluate: async (state, questions) => {
    called++;
    assert.equal(Object.keys(questions).length, 3);
    assert.match(JSON.stringify(state), /subscriber isolation/);
    return { status: "ok", answers: { t0: { type: "noul", noul: 0.1 }, t1: { type: "noul", noul: 0.9 }, t2: { type: "noul", noul: 0.2 } }, model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 1, cached: false };
  } } });
  assert.equal(called, 1);
  assert.deepEqual(semantic.selected, ["test/b.test.ts"]);
  const fallback = await chooseCheckpointTests({ mode: "jev", snapshot, changes, catalog, limit: 1, provider: { evaluate: async () => ({ status: "fallback", reason: "timeout", latencyMs: 1800 }) } });
  assert.deepEqual(fallback.selected, baseline.selected);
});

test("checkpoint executes actual selected files and preserves failures without running others", { skip: process.platform !== "darwin" }, async (t) => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, "test/selected.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; test('regression',()=>assert.equal(1,2));");
  await writeFile(join(cwd, "test/unselected.test.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('SHOULD_NOT_EXIST','x');");
  const result = await runCheckpointTests({ cwd, selected: ["test/selected.test.mjs"], protectedRoots: [], timeoutMs: 2000 });
  assert.equal(result.status, "failed");
  assert.match(result.output, /regression/);
  await assert.rejects(readFile(join(cwd, "SHOULD_NOT_EXIST")), { code: "ENOENT" });
  await assert.rejects(runCheckpointTests({ cwd, selected: ["../escape.test.mjs"], protectedRoots: [], timeoutMs: 2000 }), /workspace|test path/);
});

test("checkpoint cancels a live test process and never inherits gateway credentials", { skip: process.platform !== "darwin" }, async (t) => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, "test/signal.test.mjs"), "import assert from 'node:assert/strict'; assert.equal(process.env.AI_GATEWAY_API_KEY, undefined); console.log('CHECKPOINT_READY'); await new Promise(()=>{});");
  const controller = new AbortController();
  const result = await runCheckpointTests({ cwd, selected: ["test/signal.test.mjs"], protectedRoots: [], timeoutMs: 5000, signal: controller.signal, onOutput: (text) => { if (text.includes("CHECKPOINT_READY")) controller.abort(); } });
  assert.equal(result.status, "cancelled");
  assert.match(result.output, /CHECKPOINT_READY/);
});
