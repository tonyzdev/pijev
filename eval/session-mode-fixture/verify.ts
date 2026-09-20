import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sandboxProfile, shellEnvironment } from "../sandbox.js";

const fixture = dirname(fileURLToPath(import.meta.url));
const repository = resolve(fixture, "../..");
export const BASE_REVISION = "4e1cdefd9144beb6bb43d3f0ed7189b0609c4254";
export interface CommandResult { code: number; signal: string | null; stdout: string; stderr: string; timedOut: boolean; outputExceeded: boolean }
const inside = (root: string, target: string) => { const path = relative(root, target); return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); };
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
async function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, env: shellEnvironment(cwd), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false, outputExceeded = false, outputBytes = 0, stdout = "", stderr = "";
    const terminate = () => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, 60000);
    const append = (stream: "stdout" | "stderr", data: Buffer) => {
      const remaining = Math.max(0, 1_000_000 - outputBytes); outputBytes += data.length;
      if (stream === "stdout") stdout += data.subarray(0, remaining).toString(); else stderr += data.subarray(0, remaining).toString();
      if (outputBytes > 1_000_000) { outputExceeded = true; terminate(); }
    };
    child.stdout.on("data", (data: Buffer) => append("stdout", data)); child.stderr.on("data", (data: Buffer) => append("stderr", data));
    child.on("error", (error) => { clearTimeout(timer); terminate(); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); terminate(); done({ code: code ?? -1, signal, stdout, stderr, timedOut, outputExceeded }); });
  });
}
async function checked(command: string, args: string[], cwd: string) { const result = await run(command, args, cwd); if (result.code !== 0) throw new Error(`${command} failed: ${result.stderr}`); return result; }

/** Public base-only shallow checkout. Reference is an explicit evaluator option. */
export async function prepareWorkspace(destination: string, options: { reference?: boolean } = {}): Promise<string> {
  const workspace = resolve(destination);
  await mkdir(dirname(workspace), { recursive: true }); await mkdir(workspace);
  await checked("git", ["init", "--quiet"], workspace);
  await checked("git", ["fetch", "--quiet", "--depth", "1", repository, BASE_REVISION], workspace);
  await checked("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], workspace);
  if (options.reference) await checked("git", ["apply", join(fixture, "reference.patch")], workspace);
  await cp(join(fixture, "task.md"), join(workspace, "TASK.md"));
  await cp(join(fixture, "visible/session-mode-visible.test.ts.txt"), join(workspace, "test/session-mode-visible.test.ts"));
  await mkdir(join(workspace, ".home")); await mkdir(join(workspace, ".tmp"));
  await symlink(join(repository, "node_modules"), join(workspace, "node_modules"), "dir");
  return workspace;
}

/** Holdout is evaluator-only; invoke after generation and its subprocesses stop. */
export async function runLocalChecks(workspace: string, kind: "ordinary" | "visible" | "holdout" | "check" | "build"): Promise<CommandResult> {
  if (process.platform !== "darwin") throw new Error("Session-mode fixture requires macOS Seatbelt; no unsandboxed fallback.");
  const cwd = await realpath(workspace);
  const protectedRoots = await Promise.all([homedir(), repository].map((path) => realpath(path)));
  if (protectedRoots.some((root) => inside(cwd, root) || inside(root, cwd))) throw new Error("Use a separate disposable checkout.");
  const modules = join(cwd, "node_modules"), trustedModules = await realpath(join(repository, "node_modules"));
  const allowTrustedModules = (await lstat(modules)).isSymbolicLink() && await realpath(modules) === trustedModules;
  const ancestors: string[] = []; for (let path = dirname(trustedModules); path !== dirname(path); path = dirname(path)) ancestors.push(path);
  const dependencyRule = allowTrustedModules ? `\n(allow file-read* (subpath ${JSON.stringify(trustedModules)}))\n(allow file-read-metadata ${ancestors.map((path) => `(literal ${JSON.stringify(path)})`).join(" ")})` : "";
  const temporary = await mkdtemp(join(cwd, ".session-mode-check-"));
  // This freshly created directory avoids following any candidate-controlled
  // test-directory/file symlink. It has the same import depth as test/.
  const holdout = join(temporary, "session-mode-holdout.test.ts");
  try {
    const profile = join(temporary, "sandbox.sb");
    await writeFile(profile, sandboxProfile(cwd, protectedRoots, { allowLoopback: true }) + dependencyRule);
    let args: string[];
    if (kind === "check" || kind === "build") args = [join(cwd, "node_modules/typescript/bin/tsc"), ...(kind === "check" ? ["--noEmit"] : ["-p", "tsconfig.build.json"])];
    else {
      if (kind === "holdout") await cp(join(fixture, "holdout/session-mode.test.ts.txt"), holdout);
      const selected = kind === "ordinary"
        ? (await readdir(join(cwd, "test"))).filter((name) => name.endsWith(".test.ts") && name !== "session-mode-visible.test.ts").map((name) => join("test", name))
        : kind === "visible" ? ["test/session-mode-visible.test.ts"] : [holdout];
      args = ["--import", join(cwd, "node_modules/tsx/dist/loader.mjs"), "--test", "--test-reporter=tap", ...selected];
    }
    const result = await run("/usr/bin/sandbox-exec", ["-f", profile, process.execPath, ...args], cwd);
    const sanitize = (text: string) => text.replaceAll(cwd, "<candidate>").replaceAll(resolve(workspace), "<candidate>").replaceAll(protectedRoots[1]!, "<repository>").replaceAll(protectedRoots[0]!, "<home>");
    return { ...result, stdout: sanitize(result.stdout), stderr: sanitize(result.stderr) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
function summary(result: CommandResult) {
  const count = (name: string) => Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? 0);
  return { tests: count("tests"), pass: count("pass"), fail: count("fail"), cancelled: count("cancelled"), skipped: count("skipped"), failures: [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]) };
}
async function main() {
  const [command = "verify", destination] = process.argv.slice(2);
  if (command === "prepare") { if (!destination) throw new Error("Usage: verify.ts prepare /absolute/empty/workspace"); console.log(await prepareWorkspace(destination)); return; }
  if (command === "accept") {
    if (!destination) throw new Error("Usage: verify.ts accept /absolute/finished/candidate");
    const result = await runLocalChecks(destination, "holdout"), counts = summary(result);
    const passed = result.code === 0 && !result.timedOut && !result.outputExceeded && counts.tests === 8 && counts.pass === 8 && counts.cancelled === 0 && counts.skipped === 0;
    console.log(JSON.stringify({ passed, ...counts, ...result }, null, 2)); process.exitCode = passed ? 0 : 1; return;
  }
  if (command !== "verify") throw new Error(`Unknown command: ${command}`);
  const temporary = await mkdtemp(join(tmpdir(), "pijev-session-mode-validation-"));
  const checks: Record<string, unknown> = {}; let matched = true;
  try {
    await mkdir(join(fixture, "evidence"), { recursive: true });
    for (const variant of ["baseline", "reference"] as const) {
      const workspace = await prepareWorkspace(join(temporary, variant), { reference: variant === "reference" });
      for (const kind of ["ordinary", "visible", "holdout", "check", "build"] as const) {
        const result = await runLocalChecks(workspace, kind), counts = summary(result);
        const expectedPass = variant === "reference" || (kind !== "visible" && kind !== "holdout");
        const expectedTests = kind === "ordinary" ? 40 : kind === "visible" ? 1 : kind === "holdout" ? 8 : 0;
        const expectedFailures = expectedPass ? 0 : expectedTests;
        const expectationMatched = (result.code === 0) === expectedPass && !result.timedOut && !result.outputExceeded && counts.tests === expectedTests && counts.fail === expectedFailures && counts.cancelled === 0 && counts.skipped === 0;
        matched &&= expectationMatched;
        const log = `evidence/${variant}-${kind}.tap`; await writeFile(join(fixture, log), result.stdout + result.stderr);
        checks[`${variant}.${kind}`] = { exitCode: result.code, signal: result.signal, timedOut: result.timedOut, outputExceeded: result.outputExceeded, expectedPass, expectationMatched, log, ...counts };
        console.log(`${variant}.${kind}: ${counts.pass}/${counts.tests} pass; exit=${result.code}; matched=${expectationMatched}`);
      }
      if (variant === "baseline") {
        const cwd = await realpath(workspace), profile = join(cwd, ".isolation.sb");
        const roots = await Promise.all([homedir(), repository].map((path) => realpath(path)));
        await writeFile(profile, sandboxProfile(cwd, roots));
        const probe = `const fs=require('node:fs'), assert=require('node:assert/strict'); for(const p of ${JSON.stringify([join(repository, "package.json"), join(fixture, "reference.patch"), join(fixture, "holdout/session-mode.test.ts.txt")])}) assert.throws(()=>fs.readFileSync(p),{code:'EPERM'}); assert.throws(()=>fs.readdirSync(${JSON.stringify(homedir())}),{code:'EPERM'}); assert.ok(fs.readFileSync('TASK.md','utf8').includes('session')); assert.ok(!Object.keys(process.env).some(k=>/API_KEY|TOKEN|SECRET|PROXY|AUTH/i.test(k))); console.log('home, repository, reference and holdout blocked; public task readable; credentials stripped');`;
        const isolation = await run("/usr/bin/sandbox-exec", ["-f", profile, process.execPath, "-e", probe], cwd);
        const historyCount = Number((await checked("git", ["rev-list", "--all", "--count"], cwd)).stdout.trim());
        const remotes = (await checked("git", ["remote"], cwd)).stdout.trim();
        const expectationMatched = isolation.code === 0 && historyCount === 1 && remotes === "";
        matched &&= expectationMatched;
        checks.isolation = { expectationMatched, exitCode: isolation.code, reachableCommits: historyCount, remoteCount: remotes ? remotes.split("\n").length : 0, stdout: isolation.stdout };
      }
    }
    const artifacts: Record<string, string> = {};
    for (const file of ["task.md", "reference.patch", "visible/session-mode-visible.test.ts.txt", "holdout/session-mode.test.ts.txt", "verify.ts", "README.md"]) artifacts[file] = hash(await readFile(join(fixture, file)));
    await writeFile(join(fixture, "verification.json"), JSON.stringify({ schemaVersion: 1, verifiedAt: new Date().toISOString(), baseRevision: BASE_REVISION, sdk: "0.85.1", node: process.version, platform: process.platform, sandbox: "macOS Seatbelt; loopback only; credential allowlist; disposable checkout writes; protected home and development repository except trusted dependencies", externalModelOrJevCalls: 0, infrastructure: { "eval/sandbox.ts": hash(await readFile(join(repository, "eval/sandbox.ts"))) }, artifacts, matched, checks }, null, 2) + "\n");
  } finally { await rm(temporary, { recursive: true, force: true }); }
  process.exitCode = matched ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
