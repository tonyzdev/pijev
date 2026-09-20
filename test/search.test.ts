import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { retrieveCode } from "../src/search.js";

async function fixture(t: test.TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), "pijev-search-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src", "session.ts"), "// session storage\nexport function refreshToken() {\n  return 'token';\n}\n// --help is literal\n");
  await writeFile(join(cwd, ".env"), "refreshToken=secret\n");
  await mkdir(join(cwd, "node_modules"));
  await writeFile(join(cwd, "node_modules", "private.ts"), "refreshToken dependency\n");
  return cwd;
}

test("retrieves exact file/line excerpts while excluding hidden credentials and dependencies", async (t) => {
  const cwd = await fixture(t);
  const result = await retrieveCode({ cwd, patterns: ["refreshToken"] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.path, "src/session.ts");
  assert.equal(result.candidates[0]?.line, 2);
  assert.match(result.candidates[0]?.excerpt ?? "", /export function refreshToken/);
  assert.equal(result.truncated, false);
});

test("option-like queries are literal search data and never executed", async (t) => {
  const cwd = await fixture(t);
  const result = await retrieveCode({ cwd, patterns: ["--help"] });
  assert.equal(result.candidates[0]?.line, 5);
  assert.equal(result.candidates.length, 1);
});

test("rejects outside paths, including symlinks, and empty patterns", async (t) => {
  const cwd = await fixture(t);
  await assert.rejects(retrieveCode({ cwd, patterns: ["token"], path: "../" }), /inside/);
  await symlink(tmpdir(), join(cwd, "outside"));
  await assert.rejects(retrieveCode({ cwd, patterns: ["token"], path: "outside" }), /inside/);
  await assert.rejects(retrieveCode({ cwd, patterns: [""] }), /pattern/);
});

test("caps candidate output and explicitly reports truncation", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "many.ts"), Array.from({ length: 100 }, (_, i) => `const match${i} = 'needle';`).join("\n"));
  const result = await retrieveCode({ cwd, patterns: ["needle"], maxCandidates: 4 });
  assert.equal(result.candidates.length, 4);
  assert.equal(result.truncated, true);
});

test("no matches are a successful empty result, and cancellation aborts retrieval", async (t) => {
  const cwd = await fixture(t);
  assert.equal((await retrieveCode({ cwd, patterns: ["not-here"] })).candidates.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(retrieveCode({ cwd, patterns: ["token"], signal: controller.signal }), /abort/i);
});

test("caller globs and explicit paths cannot override exclusions or ignore files", async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, ".git"));
  await writeFile(join(cwd, ".gitignore"), "ignored/\n");
  for (const dir of [".private", "dist", "ignored"]) {
    await mkdir(join(cwd, dir));
    await writeFile(join(cwd, dir, "file.ts"), "refreshToken secret");
  }
  for (const file of ["credentials.json", "prod.env", "private.key"]) await writeFile(join(cwd, file), "refreshToken secret");
  for (const glob of ["*", "**/*", "*.ts"]) {
    const result = await retrieveCode({ cwd, patterns: ["refreshToken"], glob });
    assert.deepEqual(result.candidates.map((item) => item.path), ["src/session.ts"]);
  }
  for (const path of ["prod.env", "credentials.json", "dist", ".private"]) {
    await assert.rejects(retrieveCode({ cwd, patterns: ["refreshToken"], path }), /excludes|directory/i);
  }
  assert.equal((await retrieveCode({ cwd, patterns: ["refreshToken"], path: "ignored" })).candidates.length, 0);
});

test("ambient ripgrep configuration cannot enable hidden files or disable ignore rules", async (t) => {
  const cwd = await fixture(t);
  const config = join(cwd, "rg-config");
  await writeFile(config, "--hidden\n--no-ignore\n--follow\n");
  const previous = process.env.RIPGREP_CONFIG_PATH;
  process.env.RIPGREP_CONFIG_PATH = config;
  t.after(() => { if (previous === undefined) delete process.env.RIPGREP_CONFIG_PATH; else process.env.RIPGREP_CONFIG_PATH = previous; });
  assert.deepEqual((await retrieveCode({ cwd, patterns: ["refreshToken"] })).candidates.map((item) => item.path), ["src/session.ts"]);
});
