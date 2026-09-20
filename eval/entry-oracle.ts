import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_REVISION, prepareWorkspace } from "./checkpoint-fixture/verify.js";
import { sandboxProfile, shellEnvironment } from "./sandbox.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(repository, "eval/entry-oracle");
const inside = (root: string, target: string) => {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
export interface EntryOracleResult {
  passed: boolean; code: number; signal: string | null; timedOut: boolean; outputExceeded: boolean;
  tests: number; pass: number; fail: number; cancelled: number; skipped: number;
  failures: string[]; stdout: string; stderr: string;
}

/** Evaluator-only: call after candidate generation and all its subprocesses stop. */
export async function runEntryOracle(workspace: string): Promise<EntryOracleResult> {
  if (process.platform !== "darwin") throw new Error("Entry oracle requires macOS Seatbelt; no unsandboxed fallback.");
  const cwd = await realpath(workspace);
  const protectedRoots = await Promise.all([homedir(), repository].map((path) => realpath(path)));
  if (protectedRoots.some((root) => inside(cwd, root))) throw new Error("Use a separate disposable candidate checkout.");
  const modules = join(cwd, "node_modules");
  const trustedModules = await realpath(join(repository, "node_modules"));
  const allowTrustedModules = (await lstat(modules)).isSymbolicLink() && await realpath(modules) === trustedModules;
  const ancestors: string[] = [];
  for (let path = dirname(trustedModules); path !== dirname(path); path = dirname(path)) ancestors.push(path);
  const dependencyRule = allowTrustedModules ? `\n(allow file-read* (subpath ${JSON.stringify(trustedModules)}))\n(allow file-read-metadata ${ancestors.map((path) => `(literal ${JSON.stringify(path)})`).join(" ")})` : "";
  const temporary = await mkdtemp(join(cwd, ".entry-oracle-"));
  try {
    await mkdir(join(cwd, ".home"), { recursive: true });
    await mkdir(join(cwd, ".tmp"), { recursive: true });
    const profile = join(temporary, "sandbox.sb");
    const test = join(temporary, "entry-ownership.test.ts");
    await cp(join(fixture, "entry-ownership.test.ts.txt"), test);
    await writeFile(profile, sandboxProfile(cwd, protectedRoots, { allowLoopback: true }) + dependencyRule);
    const result = await new Promise<Omit<EntryOracleResult, "passed" | "tests" | "pass" | "fail" | "cancelled" | "skipped" | "failures">>((done, reject) => {
      const child = spawn("/usr/bin/sandbox-exec", ["-f", profile, process.execPath, "--import", join(cwd, "node_modules/tsx/dist/loader.mjs"), "--test", "--test-reporter=tap", test], { cwd, env: shellEnvironment(cwd), detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let timedOut = false, outputExceeded = false, outputBytes = 0;
      let stdout = "", stderr = "";
      const terminate = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } } };
      const timer = setTimeout(() => { timedOut = true; terminate(); }, 60000);
      const append = (stream: "stdout" | "stderr", data: Buffer) => {
        const remaining = Math.max(0, 1_000_000 - outputBytes);
        outputBytes += data.length;
        if (stream === "stdout") stdout += data.subarray(0, remaining).toString(); else stderr += data.subarray(0, remaining).toString();
        if (outputBytes > 1_000_000) { outputExceeded = true; terminate(); }
      };
      child.stdout.on("data", (data: Buffer) => append("stdout", data));
      child.stderr.on("data", (data: Buffer) => append("stderr", data));
      child.on("error", (error) => { clearTimeout(timer); terminate(); reject(error); });
      child.on("close", (code, signal) => { clearTimeout(timer); terminate(); done({ code: code ?? -1, signal, stdout, stderr, timedOut, outputExceeded }); });
    });
    const count = (name: string) => Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? 0);
    const summary = { tests: count("tests"), pass: count("pass"), fail: count("fail"), cancelled: count("cancelled"), skipped: count("skipped"), failures: [...result.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]!) };
    const sanitize = (text: string) => text.replaceAll(cwd, "<candidate>").replaceAll(resolve(workspace), "<candidate>").replaceAll(protectedRoots[1]!, "<repository>").replaceAll(protectedRoots[0]!, "<home>");
    return { ...result, ...summary, stdout: sanitize(result.stdout), stderr: sanitize(result.stderr), passed: result.code === 0 && !result.timedOut && !result.outputExceeded && summary.tests === 2 && summary.pass === 2 && summary.fail === 0 && summary.cancelled === 0 && summary.skipped === 0 };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function main() {
  const [command = "verify", candidate] = process.argv.slice(2);
  if (command === "accept") {
    if (!candidate) throw new Error("Usage: entry-oracle.ts accept /absolute/finished/candidate");
    const result = await runEntryOracle(candidate);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
    return;
  }
  if (command !== "verify") throw new Error("Usage: entry-oracle.ts verify [finished-candidate]");
  const temporary = await mkdtemp(join(tmpdir(), "pijev-entry-oracle-validation-"));
  const checks: Record<string, unknown> = {};
  let matched = true;
  try {
    await mkdir(join(fixture, "evidence"), { recursive: true });
    for (const variant of ["seed", "reference", ...(candidate ? ["prior-candidate"] : [])]) {
      const workspace = variant === "prior-candidate" ? candidate! : await prepareWorkspace(join(temporary, variant), { reference: variant === "reference" });
      const result = await runEntryOracle(workspace);
      const { stdout, stderr, ...summary } = result;
      const expectedPasses = variant === "reference" ? 2 : variant === "seed" ? 1 : 0;
      const expectedFailures = variant === "reference" ? [] : [
        "entry oracle: journal IDs exactly identify consumed SDK user entries, including a cache hit",
        ...(variant === "prior-candidate" ? ["entry oracle: newly generated journal rows display their emitted user identity"] : []),
      ];
      const expectationMatched = result.tests === 2 && result.pass === expectedPasses && result.fail === 2 - expectedPasses && result.cancelled === 0 && result.skipped === 0 && !result.timedOut && !result.outputExceeded && result.code === (variant === "reference" ? 0 : 1) && JSON.stringify(result.failures) === JSON.stringify(expectedFailures);
      matched &&= expectationMatched;
      await writeFile(join(fixture, "evidence", `${variant}.tap`), stdout + stderr);
      checks[variant] = { ...summary, expectedPasses, expectationMatched, log: `evidence/${variant}.tap` };
      console.log(`${variant}: ${result.pass}/2 pass; expected ${expectedPasses}/2; matched=${expectationMatched}`);
    }
    const hash = (text: Buffer) => createHash("sha256").update(text).digest("hex");
    const artifacts: Record<string, string> = {};
    for (const name of ["entry-ownership.test.ts.txt", "../entry-oracle.ts"]) artifacts[name] = hash(await readFile(join(fixture, name)));
    const frozenArtifacts: Record<string, string> = {};
    for (const name of ["seed.patch", "reference.patch", "task.md", "visible/decision-regression.test.ts.txt", "holdout/decision-lifecycle.test.ts.txt"]) frozenArtifacts[name] = hash(await readFile(join(repository, "eval/checkpoint-fixture", name)));
    const { dependencies } = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    await writeFile(join(fixture, "verification.json"), JSON.stringify({ schemaVersion: 1, verifiedAt: new Date().toISOString(), provenance: "Diagnostic-derived additional acceptance for future experiments; does not revise prior frozen seven-test scores.", baseRevision: BASE_REVISION, sdk: dependencies["@earendil-works/pi-coding-agent"], node: process.version, platform: process.platform, sandbox: "macOS Seatbelt; loopback only; candidate-confined writes; protected home/repository; trusted dependency read exception", credentialEnvironment: "eval/sandbox.ts shellEnvironment allowlist", externalModelOrJevCalls: 0, artifacts, frozenArtifacts, matched, checks }, null, 2) + "\n");
  } finally { await rm(temporary, { recursive: true, force: true }); }
  process.exitCode = matched ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
