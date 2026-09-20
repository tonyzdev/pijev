import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DecisionProvider } from "../src/decisions.js";
import { projectSourceEvidence, formatProjectSourceEvidence } from "../eval/project-source-evidence.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pijev-project-source-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd });
  await mkdir(join(cwd, "src")); await mkdir(join(cwd, "test"));
  await writeFile(join(cwd, "src/a.ts"), 'export const session = "session";\n');
  await writeFile(join(cwd, "src/z.ts"), 'export const x = 42;\n');
  await writeFile(join(cwd, "test/a.test.ts"), 'const session = "fixture";\n');
  return cwd;
}
const success: DecisionProvider["evaluate"] = async (state: any, questions) => ({
  status: "ok", model: "fixture", latencyMs: 1, inputTokens: 10, outputTokens: 3, cached: false,
  answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: "noul", noul: state.files[id].path === "src/z.ts" ? 0.9 : 0.1 }])),
});

test("whole-source scoring can promote a file with zero query overlap without losing any file", async t => {
  const cwd = await fixture(t);
  const baseline = await projectSourceEvidence({ cwd, query: "session", mode: "lexical" });
  const seen: Record<string, string> = {};
  const ranked = await projectSourceEvidence({ cwd, query: "session", mode: "jev", provider: { evaluate: async (state: any, questions, signal) => {
    for (const [id, file] of Object.entries(state.files) as [string, any][]) {
      seen[file.path] = file.code;
      assert.ok(questions[id]!.instructions.includes(`state.files.${id}`), "question IDs alone are not visible to Jev");
    }
    return success(state, questions, signal);
  } } });
  assert.deepEqual(seen, { "src/a.ts": 'export const session = "session";\n', "src/z.ts": 'export const x = 42;\n', "test/a.test.ts": 'const session = "fixture";\n' });
  assert.equal(ranked.ranking[0]?.path, "src/z.ts");
  assert.equal(ranked.ranking.length, 3);
  assert.equal(ranked.inventoryDigest, baseline.inventoryDigest);
  const rendered = formatProjectSourceEvidence(ranked);
  for (const path of Object.keys(seen)) assert.ok(rendered.includes(path));
  assert.ok(!rendered.includes("export const"), "deliver a manifest, not an undocumented code selection");
});

test("batching transmits complete file bodies exactly once and retains global file identities", async t => {
  const cwd = await fixture(t), seen: string[] = [];
  const full = "/* sentinel */\n" + "const value = 1;\n".repeat(80);
  for (const path of ["src/a.ts", "src/z.ts", "test/a.test.ts"]) await writeFile(join(cwd, path), full);
  const ranked = await projectSourceEvidence({ cwd, query: "session", mode: "jev", maxBatchBytes: 3000, provider: { evaluate: async (state: any, questions, signal) => {
    assert.ok(Buffer.byteLength(JSON.stringify({ model: "typesafe-ai/jev", state, questions })) <= 3000);
    for (const [id, file] of Object.entries(state.files) as [string, any][]) { seen.push(id); assert.equal(file.code, full); }
    return success(state, questions, signal);
  } } });
  assert.equal(ranked.batches.length, 3);
  assert.deepEqual(seen, ["f0", "f1", "f2"]);
  assert.equal(ranked.ranking[0]?.path, "src/z.ts");
});

test("one failed or malformed batch invalidates the whole Jev ordering instead of mixing score scales", async t => {
  const cwd = await fixture(t);
  for (const path of ["src/a.ts", "src/z.ts", "test/a.test.ts"]) await writeFile(join(cwd, path), "session ".repeat(150));
  const base = await projectSourceEvidence({ cwd, query: "session", mode: "lexical", maxBatchBytes: 2600 });
  for (const malformed of [false, true]) {
    let calls = 0;
    const result = await projectSourceEvidence({ cwd, query: "session", mode: "jev", maxBatchBytes: 2600, provider: { evaluate: async (state, questions, signal) => {
      if (++calls !== 2) return success(state, questions, signal);
      return malformed ? { status: "ok", model: "fixture", latencyMs: 1, inputTokens: 0, outputTokens: 0, cached: false, answers: {} } : { status: "fallback", reason: "timeout", latencyMs: 1 };
    } } });
    assert.equal(result.status, "fallback");
    assert.equal(calls, 3, "all planned batches are recorded, even when one failed");
    assert.deepEqual(result.ranking, base.ranking);
  }
});

test("oversized files fail before any paid request rather than silently truncating the project", async t => {
  const cwd = await fixture(t); let called = false;
  await writeFile(join(cwd, "src/z.ts"), "x".repeat(4000));
  await assert.rejects(projectSourceEvidence({ cwd, query: "session", mode: "jev", maxBatchBytes: 3000, provider: { evaluate: async (...args) => { called = true; return success(...args); } } }), /src\/z.ts.*exceeds/);
  assert.equal(called, false);
});

test("inventory includes new visible tests but reports exclusions and never follows symlink files or parents", async t => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, ".env"), "PRIVATE_ENV_SENTINEL");
  await writeFile(join(cwd, "src/credentials.ts"), "PRIVATE_SOURCE_SENTINEL");
  await writeFile(join(cwd, "README.md"), "docs");
  await mkdir(join(cwd, "node_modules")); await writeFile(join(cwd, "node_modules/dep.ts"), "PRIVATE_DEP_SENTINEL");
  await symlink("a.ts", join(cwd, "src/link.ts"));
  await mkdir(join(cwd, "old")); await writeFile(join(cwd, "old/a.ts"), "tracked");
  execFileSync("git", ["add", "old/a.ts"], { cwd });
  await rm(join(cwd, "old"), { recursive: true }); await symlink("src", join(cwd, "old"));
  const result = await projectSourceEvidence({ cwd, query: "session", mode: "jev", provider: { evaluate: async (state, questions, signal) => {
    assert.ok(!JSON.stringify(state).includes("PRIVATE_")); return success(state, questions, signal);
  } } });
  assert.equal(result.ranking.length, 3);
  for (const path of [".env", "src/credentials.ts", "README.md", "node_modules/dep.ts", "src/link.ts", "old/a.ts"]) assert.ok(result.excluded.some(e => e.path === path), path);
});

test("cancellation after a batch prevents later requests and no partial success is returned", async t => {
  const cwd = await fixture(t), controller = new AbortController(); let calls = 0;
  const recorded: number[] = [];
  for (const path of ["src/a.ts", "src/z.ts", "test/a.test.ts"]) await writeFile(join(cwd, path), "session ".repeat(150));
  await assert.rejects(projectSourceEvidence({ cwd, query: "session", mode: "jev", maxBatchBytes: 2600, signal: controller.signal,
    onBatch: async batch => { assert.equal(batch.result?.status, "ok"); if (batch.result?.status === "ok") recorded.push(batch.result.inputTokens); },
    provider: { evaluate: async (...args) => { calls++; controller.abort(); return success(...args); } } }));
  assert.equal(calls, 1);
  assert.deepEqual(recorded, [10], "retain completed usage even when cancellation rejects the overall result");
});
