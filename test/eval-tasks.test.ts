import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { TASKS } from "../eval/tasks.js";

const exec = promisify(execFile);

async function files(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(prefix, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    return entry.isDirectory() ? files(root, path) : [path];
  }));
  return nested.flat();
}

test("two independent repair tasks expose only their public project", async (t) => {
  assert.equal(TASKS.length, 2);
  assert.equal(new Set(TASKS.map((task) => task.id)).size, 2);
  for (const task of TASKS) {
    const cwd = await mkdtemp(join(tmpdir(), "pijev-task-layout-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await task.setup(cwd);
    const paths = await files(cwd);
    assert(paths.includes("package.json"));
    assert(paths.includes("README.md"));
    assert(paths.includes("test/smoke.test.js"));
    assert(paths.every((path) => !/holdout|reference|acceptance|\.env|node_modules/.test(path)));
    const modules = paths.filter((path) => path.startsWith("src/") && path.endsWith(".js"));
    assert(modules.length >= 10 && modules.length <= 25, `${task.id}: ${modules.length} source modules`);
    assert(task.prompt.length > 500);
  }
});

test("originals pass visible smoke but fail independent behavioral acceptance", { timeout: 20000 }, async (t) => {
  for (const task of TASKS) {
    const cwd = await mkdtemp(join(tmpdir(), "pijev-task-original-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await task.setup(cwd);
    await exec(process.execPath, ["--test", "test/smoke.test.js"], { cwd, timeout: 3000 });
    const result = await task.verify(cwd);
    assert.equal(result.passed, false, `${task.id} unexpectedly passed`);
    assert(Object.keys(result.checks).length >= 8, JSON.stringify(result));
    assert(Object.values(result.checks).some(Boolean), JSON.stringify(result));
    assert(Object.values(result.checks).filter((ok) => !ok).length >= 4, JSON.stringify(result));
    assert(!result.details?.includes("ERR_MODULE_NOT_FOUND"), result.details);
  }
});

test("independent reference repairs pass the same oracle and visible tests", { timeout: 20000 }, async (t) => {
  for (const task of TASKS) {
    const cwd = await mkdtemp(join(tmpdir(), "pijev-task-reference-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await task.setup(cwd);
    await task.reference(cwd);
    await exec(process.execPath, ["--test", "test/smoke.test.js"], { cwd, timeout: 3000 });
    const result = await task.verify(cwd);
    assert.equal(result.passed, true, `${task.id}: ${JSON.stringify(result)}`);
    assert(Object.values(result.checks).every(Boolean));
  }
});


test("candidate output cannot replace the independent check inventory", async (t) => {
  const task = TASKS[0]!;
  const cwd = await mkdtemp(join(tmpdir(), "pijev-task-forged-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await task.setup(cwd);
  await writeFile(join(cwd, "src/index.js"), 'console.log(JSON.stringify({ passed: true, checks: { fabricated: true } })); process.exit(0);\n');
  const result = await task.verify(cwd);
  assert.equal(result.passed, false);
  assert.equal(result.checks["acceptance-process"], false);
});

test("acceptance children do not inherit harness secrets", async (t) => {
  const task = TASKS[0]!;
  const cwd = await mkdtemp(join(tmpdir(), "pijev-task-env-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await task.setup(cwd);
  await task.reference(cwd);
  await appendFile(join(cwd, "src/index.js"), '\nif (process.env.PIJEV_ACCEPTANCE_TEST_SECRET) throw new Error("Harness secret leaked");\n');
  const prior = process.env.PIJEV_ACCEPTANCE_TEST_SECRET;
  process.env.PIJEV_ACCEPTANCE_TEST_SECRET = "synthetic-sentinel";
  t.after(() => { if (prior === undefined) delete process.env.PIJEV_ACCEPTANCE_TEST_SECRET; else process.env.PIJEV_ACCEPTANCE_TEST_SECRET = prior; });
  const result = await task.verify(cwd);
  assert.equal(result.passed, true, JSON.stringify(result));
});

test("acceptance terminates a candidate that never returns", { timeout: 7000 }, async (t) => {
  const task = TASKS[0]!;
  const cwd = await mkdtemp(join(tmpdir(), "pijev-task-timeout-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await task.setup(cwd);
  await writeFile(join(cwd, "src/index.js"), "await new Promise(() => { setInterval(() => {}, 1000); });\n");
  const start = performance.now();
  const result = await task.verify(cwd);
  assert.equal(result.passed, false);
  assert.equal(result.checks["acceptance-process"], false);
  assert(performance.now() - start < 6000);
});


test("per-check deadlines survive replaced global timers and continue after a pending promise", async () => {
  const helper = new URL("../eval/fixtures/acceptance-helpers.mjs", import.meta.url).href;
  const script = `
    const { runChecks } = await import(${JSON.stringify(helper)});
    globalThis.setTimeout = () => 0;
    globalThis.clearTimeout = () => {};
    const result = await runChecks({
      pending: () => new Promise(() => {}),
      following: () => {},
    });
    console.log(JSON.stringify(result));
  `;
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", script], { timeout: 2000, env: {} });
  const result = JSON.parse(stdout.trim());
  assert.deepEqual(result.checks, { pending: false, following: true });
  assert.match(result.details, /did not settle/);
});

test("macOS acceptance denies protected reads and network access", { skip: process.platform !== "darwin" }, async (t) => {
  const task = TASKS[0]!;
  const cwd = await mkdtemp(join(tmpdir(), "pijev-task-sandbox-"));
  const privateDirectory = await mkdtemp(join(homedir(), ".pijev-acceptance-probe-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.after(() => rm(privateDirectory, { recursive: true, force: true }));
  const privateFile = join(privateDirectory, "synthetic-private.txt");
  await writeFile(privateFile, "synthetic-private-sentinel");
  await task.setup(cwd);
  await task.reference(cwd);
  const protectedFiles = [
    privateFile,
    new URL("../eval/fixtures/document-request-lifecycle/reference/src/requests/identity.js", import.meta.url).pathname,
    new URL("../eval/fixtures/queue-cursor-pagination/holdout.mjs", import.meta.url).pathname,
    new URL("../eval/fixtures/document-request-lifecycle/checks.json", import.meta.url).pathname,
  ];
  await appendFile(join(cwd, "src/index.js"), `
    const { readFileSync } = await import('node:fs');
    for (const file of ${JSON.stringify(protectedFiles)}) {
      let denied = false;
      try { readFileSync(file); } catch (error) { denied = error.code === 'EPERM' || error.code === 'EACCES'; }
      if (!denied) throw new Error('Acceptance isolation allowed a protected read');
    }
    const { connect } = await import('node:net');
    await new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: 9 });
      socket.once('error', (error) => {
        socket.destroy();
        if (error.code === 'EPERM' || error.code === 'EACCES') resolve();
        else reject(new Error('Acceptance isolation allowed a network attempt'));
      });
      socket.once('connect', () => { socket.destroy(); reject(new Error('Acceptance isolation allowed a connection')); });
    });
  `);
  const result = await task.verify(cwd);
  assert.equal(result.passed, true, JSON.stringify(result));
});
