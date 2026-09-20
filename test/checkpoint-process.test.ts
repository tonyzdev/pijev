import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runCheckpointTests } from "../eval/checkpoint.js";
import { shellEnvironment } from "../eval/sandbox.js";

const killGroup = (pid: number) => { try { process.kill(-pid, "SIGKILL"); } catch { /* Already reaped. */ } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitGone(pid: number) {
  for (let attempt = 0; attempt < 100 && alive(pid); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(alive(pid), false, `Checkpoint process ${pid} must be gone`);
}
async function workspace(t: test.TestContext) {
  const cwd = await mkdtemp("/private/tmp/pijev-cpp-");
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await Promise.all(["test", ".home", ".tmp"].map((path) => mkdir(join(cwd, path))));
  return cwd;
}

for (const inheritedPipes of [false, true]) {
  test(inheritedPipes ? "checkpoint bounds a descendant that keeps the test runner's pipes open" : "checkpoint reaps a successful test's leftover descendant", { skip: process.platform !== "darwin", timeout: 10000 }, async (t) => {
    const cwd = await workspace(t);
    let descendant: number | undefined;
    t.after(() => { if (descendant) try { process.kill(descendant, "SIGKILL"); } catch {} });
    await writeFile(join(cwd, "test/descendant.test.mjs"), `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ${inheritedPipes ? "['ignore', 'inherit', 'inherit']" : "'ignore'"} });
writeFileSync('descendant.pid', String(child.pid));
child.unref();
`);
    const events: { event: string; pid: number }[] = [];
    const result = await runCheckpointTests({ cwd, selected: ["test/descendant.test.mjs"], protectedRoots: [], timeoutMs: 3000, onProcess: (event, pid) => { events.push({ event, pid }); } });
    descendant = Number(await readFile(join(cwd, "descendant.pid"), "utf8"));
    await waitGone(descendant);
    // Inherited pipes keep Node's test worker active; its ordinary deadline
    // must reap that whole group. With closed pipes, the runner exits normally.
    assert.equal(result.status, inheritedPipes ? "timeout" : "passed");
    assert.deepEqual(events.map((entry) => entry.event), ["start", "stop"]);
    assert.equal(events[0]!.pid, events[1]!.pid);
    assert.equal(alive(events[1]!.pid), false, "Stop is reported only after the checkpoint owner closes");
  });
}

test("parent callback tracking reaps a checkpoint before terminating its owner with SIGTERM", { skip: process.platform !== "darwin", timeout: 10000 }, async (t) => {
  const cwd = await workspace(t);
  await writeFile(join(cwd, "test/pending.test.mjs"), "console.log('CHECKPOINT_READY'); setInterval(() => {}, 1000);\n");
  const groups = new Set<number>();
  let owner: ChildProcess | undefined;
  let stopping = false;
  t.after(() => { for (const pid of groups) killGroup(pid); if (owner?.pid) killGroup(owner.pid); });
  const code = `const { runCheckpointTests } = await import(${JSON.stringify(pathToFileURL(resolve("eval/checkpoint.ts")).href)});
await runCheckpointTests({ cwd: ${JSON.stringify(cwd)}, selected: ['test/pending.test.mjs'], protectedRoots: [], timeoutMs: 12000,
  onProcess: (event, pid) => console.log(JSON.stringify({ kind: 'process', event, pid })),
  onOutput: text => console.log(JSON.stringify({ kind: 'output', text })) });`;
  owner = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: process.cwd(), env: shellEnvironment(cwd), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(owner, "exit");
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  let pending = "";
  owner.stdout!.on("data", (chunk: Buffer) => {
    pending += chunk.toString();
    let newline: number;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      const event = JSON.parse(line) as { kind: string; event?: string; pid?: number; text?: string };
      if (event.kind === "process" && event.pid) {
        if (event.event === "start") { groups.add(event.pid); if (stopping) killGroup(event.pid); }
        else if (event.event === "stop") groups.delete(event.pid);
      }
      if (event.kind === "output" && event.text?.includes("CHECKPOINT_READY")) ready();
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([started, new Promise<void>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Checkpoint fixture did not start")), 5000); })]);
  } finally { if (timer) clearTimeout(timer); }
  const admitted = [...groups];
  assert.equal(admitted.length, 1, "The parent must learn the detached group before tests run");
  stopping = true;
  for (const pid of groups) killGroup(pid);
  process.kill(-owner.pid!, "SIGTERM");
  await exited;
  await Promise.all(admitted.map(waitGone));
});
