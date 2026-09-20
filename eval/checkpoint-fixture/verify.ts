import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shellEnvironment, sandboxProfile } from "../sandbox.js";

const fixture = dirname(fileURLToPath(import.meta.url));
const repository = resolve(fixture, "../..");
export const BASE_REVISION = "4e1cdefd9144beb6bb43d3f0ed7189b0609c4254";
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
interface CommandResult { code: number; signal: string | null; stdout: string; stderr: string; timedOut: boolean; outputExceeded: boolean }
async function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = shellEnvironment(cwd)): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let timedOut = false, outputExceeded = false, outputBytes = 0;
    const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } } };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, 60000);
    let stdout = "", stderr = "";
    const append = (stream: "stdout" | "stderr", data: Buffer) => {
      const remaining = Math.max(0, 1_000_000 - outputBytes);
      outputBytes += data.length;
      const text = data.subarray(0, remaining).toString();
      if (stream === "stdout") stdout += text; else stderr += text;
      if (outputBytes > 1_000_000) { outputExceeded = true; terminate(); }
    };
    child.stdout.on("data", (data: Buffer) => append("stdout", data));
    child.stderr.on("data", (data: Buffer) => append("stderr", data));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); terminate(); resolve({ code: code ?? -1, signal, stdout, stderr, timedOut, outputExceeded }); });
  });
}
async function checked(command: string, args: string[], cwd: string) {
  const result = await run(command, args, cwd);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

/** Public material only. No holdout, reference, README, or evidence is copied. */
export async function prepareWorkspace(destination: string, options: { reference?: boolean } = {}): Promise<string> {
  const workspace = resolve(destination);
  await mkdir(dirname(workspace), { recursive: true });
  // Fetch only the public base commit. A full local clone would expose later
  // fixed source through Git history even after checking out the seed revision.
  await mkdir(workspace);
  await checked("git", ["init", "--quiet"], workspace);
  await checked("git", ["fetch", "--quiet", "--depth", "1", repository, BASE_REVISION], workspace);
  await checked("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], workspace);
  const remotes = (await checked("git", ["remote"], workspace)).stdout.trim().split("\n").filter(Boolean);
  for (const remote of remotes) await checked("git", ["remote", "remove", remote], workspace);
  await checked("git", ["apply", join(fixture, "seed.patch")], workspace);
  if (options.reference) await checked("git", ["apply", join(fixture, "reference.patch")], workspace);
  await cp(join(fixture, "visible/decision-regression.test.ts.txt"), join(workspace, "test/decision-regression.test.ts"));
  await cp(join(fixture, "task.md"), join(workspace, "TASK.md"));
  await mkdir(join(workspace, ".home"));
  await mkdir(join(workspace, ".tmp"));
  // Dependencies are read-only under Seatbelt; no package install or remote service is needed.
  await symlink(join(repository, "node_modules"), join(workspace, "node_modules"), "dir");
  return workspace;
}

export async function runLocalChecks(workspace: string, kind: "visible" | "holdout" | "ordinary" | "check" | "build"): Promise<CommandResult> {
  const cwd = await realpath(workspace);
  const profile = join(cwd, ".checkpoint-validation.sb");
  // Protect user credentials/config and the development checkout. Only the
  // exact trusted dependency symlink created by prepareWorkspace is readable.
  // Experimental candidates may instead have their own installed node_modules.
  const protectedRoots = await Promise.all([homedir(), repository].map((path) => realpath(path)));
  const modules = join(cwd, "node_modules");
  const trustedModules = await realpath(join(repository, "node_modules"));
  const allowTrustedModules = (await lstat(modules)).isSymbolicLink() && await realpath(modules) === trustedModules;
  const moduleAncestors: string[] = [];
  for (let path = dirname(trustedModules); path !== dirname(path); path = dirname(path)) moduleAncestors.push(path);
  // Node's realpath resolution lstats each ancestor; metadata permission does
  // not permit directory listing or reading any sibling file contents.
  const dependencyRule = allowTrustedModules ? `\n(allow file-read* (subpath ${JSON.stringify(trustedModules)}))\n(allow file-read-metadata ${moduleAncestors.map((path) => `(literal ${JSON.stringify(path)})`).join(" ")})` : "";
  await writeFile(profile, sandboxProfile(cwd, protectedRoots, { allowLoopback: true }) + dependencyRule);
  const tests = (await readdir(join(cwd, "test"))).filter((name) => name.endsWith(".test.ts") && !name.startsWith("decision-regression") && !name.startsWith("checkpoint-holdout"));
  let args: string[];
  if (kind === "check" || kind === "build") {
    args = [join(cwd, "node_modules/typescript/bin/tsc"), ...(kind === "check" ? ["--noEmit"] : ["-p", "tsconfig.build.json"])];
  } else {
    if (kind === "holdout") await cp(join(fixture, "holdout/decision-lifecycle.test.ts.txt"), join(cwd, "test/checkpoint-holdout.test.ts"));
    const selected = kind === "visible" ? ["test/decision-regression.test.ts"] : kind === "holdout" ? ["test/checkpoint-holdout.test.ts"] : tests.map((name) => `test/${name}`);
    args = ["--import", join(cwd, "node_modules/tsx/dist/loader.mjs"), "--test", "--test-reporter=tap", ...selected];
  }
  try { return await run("/usr/bin/sandbox-exec", ["-f", profile, process.execPath, ...args], cwd); }
  finally { if (kind === "holdout") await rm(join(cwd, "test/checkpoint-holdout.test.ts"), { force: true }); }
}

function tapSummary(result: CommandResult) {
  return {
    tests: Number(result.stdout.match(/^# tests (\d+)$/m)?.[1] ?? 0),
    pass: Number(result.stdout.match(/^# pass (\d+)$/m)?.[1] ?? 0),
    fail: Number(result.stdout.match(/^# fail (\d+)$/m)?.[1] ?? 0),
    cancelled: Number(result.stdout.match(/^# cancelled (\d+)$/m)?.[1] ?? 0),
    failures: [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]),
  };
}

async function main() {
  const [command = "verify", destination] = process.argv.slice(2);
  if (command === "prepare") {
    if (!destination) throw new Error("Usage: verify.ts prepare /absolute/empty/workspace");
    console.log(await prepareWorkspace(destination)); return;
  }
  if (command === "accept") {
    if (!destination) throw new Error("Usage: verify.ts accept /absolute/candidate/workspace");
    const result = await runLocalChecks(destination, "holdout");
    const summary = tapSummary(result);
    const passed = result.code === 0 && !result.timedOut && !result.outputExceeded && summary.tests === 7 && summary.pass === 7 && summary.cancelled === 0;
    console.log(JSON.stringify({ passed, ...summary, ...result }, null, 2));
    process.exitCode = passed ? 0 : 1; return;
  }
  if (command !== "verify") throw new Error(`Unknown command: ${command}`);
  const temporary = await mkdtemp(join(tmpdir(), "pijev-checkpoint-validation-"));
  const checks: Record<string, unknown> = {};
  let matched = true;
  try {
    for (const variant of ["seed", "reference"] as const) {
      const workspace = await prepareWorkspace(join(temporary, variant), { reference: variant === "reference" });
      for (const kind of ["ordinary", "visible", "holdout", "check", "build"] as const) {
        const result = await runLocalChecks(workspace, kind);
        const expectedPass = variant === "reference" || (kind !== "visible" && kind !== "holdout");
        const summary = tapSummary(result);
        const expectedTests = kind === "ordinary" ? 40 : kind === "visible" ? 1 : kind === "holdout" ? 7 : 0;
        const expectedFailures = expectedPass ? 0 : kind === "visible" ? 1 : 2;
        const expectationMatched = (result.code === 0) === expectedPass && !result.timedOut && !result.outputExceeded && summary.tests === expectedTests && summary.fail === expectedFailures && summary.cancelled === 0;
        matched &&= expectationMatched;
        const log = `${variant}-${kind}.tap`;
        await writeFile(join(fixture, "evidence", log), (result.stdout + result.stderr).replaceAll(await realpath(workspace), "<candidate>").replaceAll(workspace, "<candidate>"));
        checks[`${variant}.${kind}`] = { exitCode: result.code, signal: result.signal, timedOut: result.timedOut, outputExceeded: result.outputExceeded, expectedPass, expectationMatched, log: `evidence/${log}`, ...summary };
        console.log(`${variant}.${kind}: ${result.code === 0 ? "PASS" : "FAIL"} (expected ${expectedPass ? "PASS" : "FAIL"})`);
      }
      if (variant === "seed") {
        const cwd = await realpath(workspace);
        const probe = `
          const fs = require("node:fs");
          const assert = require("node:assert/strict");
          const forbiddenFiles = ${JSON.stringify([join(repository, "package.json"), join(fixture, "reference.patch")])};
          for (const path of forbiddenFiles) assert.throws(() => fs.readFileSync(path), { code: "EPERM" });
          assert.throws(() => fs.readdirSync(${JSON.stringify(homedir())}), { code: "EPERM" });
          assert.ok(fs.readFileSync("src/extension.ts", "utf8").includes("createPijevExtension"));
          assert.ok(fs.readFileSync("node_modules/tsx/package.json", "utf8").includes("tsx"));
          assert.ok(!Object.keys(process.env).some((key) => /API_KEY|TOKEN|SECRET|PROXY|AUTH/i.test(key)));
          console.log(JSON.stringify({ blockedHome: true, blockedDevelopmentRepository: true, blockedReference: true, allowedCandidateSource: true, allowedDependencies: true, credentialEnvironmentStripped: true }));
        `;
        const isolation = await run("/usr/bin/sandbox-exec", ["-f", join(cwd, ".checkpoint-validation.sb"), process.execPath, "-e", probe], cwd);
        const shallow = (await checked("git", ["rev-list", "--all", "--count"], cwd)).stdout.trim();
        const remotes = (await checked("git", ["remote"], cwd)).stdout.trim();
        const isolated = isolation.code === 0 && !isolation.timedOut && !isolation.outputExceeded && shallow === "1" && remotes === "";
        matched &&= isolated;
        checks["isolation"] = { expectationMatched: isolated, exitCode: isolation.code, reachableCommits: Number(shallow), remoteCount: remotes ? remotes.split("\n").length : 0, stdout: isolation.stdout, stderr: isolation.stderr };
        await writeFile(join(fixture, "evidence/isolation.json"), JSON.stringify(checks["isolation"], null, 2) + "\n");
        console.log(`isolation: ${isolated ? "PASS" : "FAIL"}`);
      }
    }
    const packageJson = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const artifacts: Record<string, string> = {};
    for (const name of ["seed.patch", "reference.patch", "task.md", "visible/decision-regression.test.ts.txt", "holdout/decision-lifecycle.test.ts.txt"]) artifacts[name] = hash(await readFile(join(fixture, name)));
    await writeFile(join(fixture, "verification.json"), JSON.stringify({ schemaVersion: 1, verifiedAt: new Date().toISOString(), baseRevision: BASE_REVISION, sdk: packageJson.dependencies["@earendil-works/pi-coding-agent"], node: process.version, platform: process.platform, sandbox: "macOS Seatbelt; local network only; writes confined to disposable clone; home and development repository blocked except trusted dependency symlink", credentialEnvironment: "eval/sandbox.ts shellEnvironment allowlist", externalModelOrJevCalls: 0, artifacts, matched, checks }, null, 2) + "\n");
  } finally { await rm(temporary, { recursive: true, force: true }); }
  process.exitCode = matched ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
