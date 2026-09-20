import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { readRecentDecisions } from "../src/telemetry.js";
import { goldFiles } from "./swebench-retrieval.js";

/**
 * End-to-end comparison on SWE-bench Verified: the same main model drives plain
 * Pi, PiJev without Jev (BM25 shortlist only) and PiJev with Jev. Every tool call is
 * classified so search effort, context spent and outcome can be compared per task.
 * Outcome is the benchmark's own oracle: FAIL_TO_PASS tests after the test patch.
 */
type Arm = "pi" | "pij-off" | "pij-jev";
interface Instance {
  repo: string; instance_id: string; base_commit: string; problem_statement: string; patch: string; test_patch: string; FAIL_TO_PASS: string; PASS_TO_PASS: string; difficulty: string;
  /** Repositories other than SWE-bench's: where to clone from, how to install, and which test files the oracle runs with pytest. */
  runner?: "django" | "pytest" | "node-test"; clone_url?: string; install?: string; test_files?: string[]; repo_dir?: string;
}

const exec = promisify(execFile);
const { values } = parseArgs({ options: {
  dataset: { type: "string", default: "swe_verified.json" }, instances: { type: "string" }, repos: { type: "string", default: "repos" },
  out: { type: "string", default: "swebench-agent-results" }, arms: { type: "string", default: "pi,pij-off,pij-jev" },
  model: { type: "string", default: "deepseek-v4-flash" }, parallel: { type: "string", default: "3" },
  turns: { type: "string", default: "40" }, tokens: { type: "string", default: "600000" }, seconds: { type: "string", default: "540" },
  "max-output-tokens": { type: "string", default: "8192" }, python: { type: "string", default: "3.8" },
  "allow-read": { type: "string", description: "Colon-separated roots the sandboxed bash may read, e.g. a relocated Python install" },
} });
if (process.platform !== "darwin") throw new Error("The bash sandbox in eval/cli-control.ts requires macOS.");
for (const name of ["DEEPSEEK_API_KEY", "AI_GATEWAY_API_KEY"]) if (!process.env[name]) throw new Error(`Load ${name} in the harness environment.`);
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protectedHome = await realpath(homedir());
const arms = values.arms!.split(",") as Arm[];
const wanted = new Set(values.instances!.split(","));
const dataset = (JSON.parse(await readFile(values.dataset!, "utf8")) as Instance[]).filter(r => wanted.has(r.instance_id));
if (dataset.length !== wanted.size) throw new Error(`Missing instances: ${[...wanted].filter(id => !dataset.some(r => r.instance_id === id)).join(", ")}`);
const out = resolve(values.out!);
await mkdir(out, { recursive: true });
const secrets = [process.env.DEEPSEEK_API_KEY!, process.env.AI_GATEWAY_API_KEY!];
const clean = (text: string) => secrets.reduce((t, s) => t.replaceAll(s, "[redacted]"), text);

/** Search effort is the quantity under test, so bash is classified by what it does. */
export function classify(tool: string, args: Record<string, unknown>): "search" | "read" | "edit" | "test" | "other" {
  if (tool === "pijev_search") return "search";
  if (tool === "read") return "read";
  if (tool === "edit" || tool === "write") return "edit";
  if (tool !== "bash") return "other";
  const cmd = String(args.command ?? "");
  if (/runtests\.py|pytest|python[\d.]*\s+-m\s+(?:unittest|pytest)|\bbin\/test\b|\bnode\b[^|;&]*\s--test\b|\btsx\s+--test\b|\b(?:pnpm|npm|yarn)\s+(?:run\s+)?test\b|\bvitest\b|\bjest\b/.test(cmd)) return "test";
  if (/(?:^|[\s|;&(])(?:rg|grep|egrep|fgrep|ag|ack|find|fd|locate|tree)\b|git\s+(?:grep|ls-files)|(?:^|[\s|;&(])ls\b/.test(cmd)) return "search";
  if (/(?:^|[\s|;&(])(?:cat|head|tail|less|more|wc)\b|sed\s+-n|git\s+(?:show|log|diff|blame)/.test(cmd)) return "read";
  return "other";
}

async function prepareWorkspace(inst: Instance, dir: string) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const repo = resolve(values.repos!, inst.repo_dir ?? inst.repo.split("/")[1]!);
  // A self-contained checkout: the sandbox denies reads outside the workspace,
  // so a worktree or shared clone would break every git command the agent runs.
  await new Promise<void>((done, fail) => {
    const archive = spawn("git", ["-C", repo, "archive", inst.base_commit]);
    const tar = spawn("tar", ["-x", "-C", dir], { stdio: [archive.stdout, "ignore", "inherit"] });
    tar.on("close", code => code === 0 ? done() : fail(new Error(`tar exited ${code}`)));
  });
  const git = (...args: string[]) => exec("git", ["-c", "user.name=eval", "-c", "user.email=eval@local", ...args], { cwd: dir, maxBuffer: 64_000_000 });
  await git("init", "-q");
  await writeFile(join(dir, ".git", "info", "exclude"), ".venv/\n.home/\n.tmp/\nnode_modules\n");
  await git("add", "-A");
  await git("commit", "-qm", "base");
  await Promise.all([mkdir(join(dir, ".home")), mkdir(join(dir, ".tmp"))]);
  if (inst.runner === "node-test") {
    // A Node repository: the install step links a dependency tree shared read-only
    // across workspaces (see --allow-read); nothing is downloaded or built here.
    if (inst.install) await exec("/bin/bash", ["-lc", inst.install], { cwd: dir, timeout: 600_000 });
    return;
  }
  await exec("uv", ["venv", "-q", "--python", values.python!, ".venv"], { cwd: dir });
  if (inst.install) await exec("/bin/bash", ["-lc", inst.install], { cwd: dir, timeout: 600_000 });
  else {
    const extra = inst.repo === "sympy/sympy" ? ["mpmath"] : [];
    await exec("uv", ["pip", "install", "-q", "-p", ".venv", "-e", ".", ...extra], { cwd: dir, timeout: 300_000 });
  }
}

function prompt(inst: Instance) {
  return `You are working in a checkout of ${inst.repo} at the commit where the following issue was reported.

<issue>
${inst.problem_statement.trim()}
</issue>

Resolve the issue by changing the library source code. Make the minimal correct change; do not modify or add tests. ${inst.runner === "node-test" ? "The repository's dependencies are installed in node_modules, so you may run targeted tests, for example \`node --import tsx --test <test file>\`" : `A Python virtual environment at .venv has this checkout installed in editable mode, so you may run targeted tests, for example ${inst.runner === "pytest" ? "\`.venv/bin/python -m pytest <test file>\`" : "\`.venv/bin/python tests/runtests.py <app_label>\` for Django"}`} — never the full suite. Do not commit. Work autonomously and do not ask questions. When finished, describe the change in one paragraph.`;
}

async function runAgent(inst: Instance, arm: Arm, dir: string, workspace: string) {
  const common = ["--mode", "json", "--print", "--provider", "deepseek", "--model", values.model!, "--thinking", "off",
    "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-extensions", "--offline",
    "--extension", join(project, "eval", "cli-control.ts"), "--session-dir", join(dir, "sessions"), prompt(inst)];
  const argv = arm === "pi" ? [join(project, "node_modules", ".bin", "pi"), ...common]
    : [join(project, "bin", "pijev.mjs"), "--jev-mode", arm === "pij-jev" ? "assist" : "off", ...common];
  const env: NodeJS.ProcessEnv = {
    PATH: [dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    HOME: join(workspace, ".home"), TMPDIR: join(workspace, ".tmp"), LANG: "en_US.UTF-8",
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, PIJEV_HOME: join(dir, "home"), PI_CODING_AGENT_DIR: join(dir, "home"),
    PIJEV_EVAL_WORKSPACE: workspace, PIJEV_EVAL_STATS: join(dir, "control.json"), PIJEV_EVAL_PROTECTED_HOME: protectedHome,
    PIJEV_EVAL_TURNS: values.turns, PIJEV_EVAL_TOKENS: values.tokens, PIJEV_EVAL_SECONDS: values.seconds, PIJEV_EVAL_MAX_OUTPUT_TOKENS: values["max-output-tokens"],
    PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1",
    ...(values["allow-read"] ? { PIJEV_EVAL_ALLOW_READ: values["allow-read"] } : {}),
  };
  if (arm !== "pi") {
    // Both PiJev arms get the initial source briefing; only the ranker differs.
    Object.assign(env, { PIJEV_SOURCE_BRIEFING: "1", PIJEV_JEV_TIMEOUT_MS: "25000" });
    if (arm === "pij-jev") Object.assign(env, { AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY, PIJEV_JEV_PROVIDER: "vercel" });
  }
  const trace = createWriteStream(join(dir, "trace.jsonl"), { mode: 0o600 });
  const errors = createWriteStream(join(dir, "stderr.txt"), { mode: 0o600 });
  const child = spawn(process.execPath, argv, { cwd: workspace, detached: true, stdio: ["ignore", "pipe", "pipe"], env });
  const calls: { tool: string; kind: ReturnType<typeof classify>; resultBytes: number; turn: number; command?: string }[] = [];
  const open = new Map<string, number>();
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estimatedUsd: 0, responses: 0, peakContext: 0 };
  let turns = 0, pending = "", modelError = false, finalText = "";
  const started = performance.now();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data: string) => {
    pending += data;
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = clean(pending.slice(0, nl)); pending = pending.slice(nl + 1);
      trace.write(`${line}\n`);
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === "turn_start") turns++;
      if (event.type === "tool_execution_start") {
        const args = (event.args ?? event.input ?? {}) as Record<string, unknown>;
        const record = { tool: event.toolName, kind: classify(event.toolName, args), resultBytes: 0, turn: turns, ...(event.toolName === "bash" ? { command: String(args.command ?? "").slice(0, 300) } : {}) };
        open.set(event.toolCallId ?? String(calls.length), calls.push(record) - 1);
      }
      if (event.type === "tool_execution_end") {
        const index = open.get(event.toolCallId); open.delete(event.toolCallId);
        if (index !== undefined) calls[index]!.resultBytes = Buffer.byteLength(JSON.stringify(event.result ?? event.output ?? ""));
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const u = event.message.usage ?? {};
        const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
        usage.input += n(u.input); usage.output += n(u.output); usage.cacheRead += n(u.cacheRead); usage.cacheWrite += n(u.cacheWrite);
        usage.estimatedUsd += n(u.cost?.total); usage.responses++;
        usage.peakContext = Math.max(usage.peakContext, n(u.input) + n(u.cacheRead) + n(u.cacheWrite));
        if (event.message.stopReason === "error") modelError = true;
        const text = (event.message.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
        if (text.trim()) finalText = text;
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => errors.write(clean(d)));
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, "SIGTERM"); } catch {} setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch {} }, 5000); }, (Number(values.seconds) + 60) * 1000);
  const exitCode = await new Promise<number | null>(r => child.once("close", code => r(code)));
  clearTimeout(timer);
  await Promise.all([new Promise<void>(d => trace.end(d)), new Promise<void>(d => errors.end(d))]);
  const control = await readFile(join(dir, "control.json"), "utf8").then(t => JSON.parse(t)).catch(() => undefined);
  const decisions = arm === "pij-jev" ? await readRecentDecisions(join(dir, "home"), 500) : [];
  const jev = decisions.reduce((s, r) => ({ calls: s.calls + 1, ok: s.ok + Number(r.status === "ok"), cached: s.cached + Number(r.cached), fallbacks: s.fallbacks + Number(r.status === "fallback"),
    inputTokens: s.inputTokens + (r.inputTokens ?? 0), outputTokens: s.outputTokens + (r.outputTokens ?? 0), latencyMs: s.latencyMs + r.latencyMs, kinds: { ...s.kinds, [r.kind]: (s.kinds[r.kind] ?? 0) + 1 } }),
    { calls: 0, ok: 0, cached: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, kinds: {} as Record<string, number> });
  const byKind: Record<string, { calls: number; resultBytes: number }> = {};
  for (const c of calls) { const k = byKind[c.kind] ??= { calls: 0, resultBytes: 0 }; k.calls++; k.resultBytes += c.resultBytes; }
  // A transient provider error that Pi retried still ends in a completed run; it is
  // recorded, not allowed to relabel the outcome.
  const termination = timedOut ? "timeout" : control?.termination === "budget" ? "budget" : control?.isolationError || exitCode !== 0 || (modelError && !control) ? "error" : "completed";
  return { termination, modelErrors: modelError, budgetReason: control?.budgetReason, exitCode, turns, usage, requests: control?.requests ?? usage.responses, calls, byKind, jev, finalText: finalText.slice(0, 2000), elapsedMs: Math.round(performance.now() - started) };
}

/** The benchmark's own oracle: apply the reference test patch on top of the agent's change
 * and run the modules that FAIL_TO_PASS and PASS_TO_PASS name. Instances are pre-screened so
 * that, in this environment, the unfixed tree fails FAIL_TO_PASS and the gold patch passes it. */
export function parseDjangoResults(output: string): Map<string, string> {
  const status = new Map<string, string>();
  const result = "(ok|FAIL|ERROR|skipped.*|expected failure|unexpected success)";
  let pending: string | undefined;
  for (const line of output.split("\n")) {
    let m = new RegExp(`^(\\S+) \\(([\\w.]+)\\)(?: \\(.*?\\))? \\.\\.\\. ${result}$`).exec(line);
    if (m) { status.set(`${m[1]} (${m[2]})`, m[3]!); pending = undefined; continue; }
    m = /^(\S+) \(([\w.]+)\)(?: \(.*?\))?$/.exec(line);
    if (m) { pending = `${m[1]} (${m[2]})`; continue; }
    // A test with a docstring prints its id on one line and the docstring plus result on the next.
    m = new RegExp(`^(.*?) \\.\\.\\. ${result}$`).exec(line);
    if (m) { if (pending) status.set(pending, m[2]!); status.set(m[1]!.trim(), m[2]!); pending = undefined; }
  }
  return status;
}

/** pytest -rA summary lines: `PASSED path::test`, `FAILED path::test - reason`. */
export function parsePytestResults(output: string): Map<string, string> {
  const status = new Map<string, string>();
  for (const m of output.matchAll(/^(PASSED|FAILED|ERROR|XFAIL|XPASS|SKIPPED) (\S+)/gm)) status.set(m[2]!, m[1] === "PASSED" || m[1] === "XFAIL" ? "ok" : m[1] === "SKIPPED" ? "skipped" : m[1]!);
  return status;
}

/** Node's TAP reporter: `# Subtest: name` opens a block and `ok N - name` closes it at the same
 * indent, children first. Ids are `file::outer > inner`, matching the screener that chose FAIL_TO_PASS. */
export function parseNodeTestResults(output: string, file: string): Map<string, string> {
  const status = new Map<string, string>();
  let names: string[] = [];
  for (const line of output.split("\n")) {
    const indent = Math.floor((line.length - line.trimStart().length) / 4);
    const s = line.trim();
    let m = /^# Subtest: (.*)$/.exec(s);
    if (m) { names = [...names.slice(0, indent), m[1]!]; continue; }
    m = /^(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO).*)?$/.exec(s);
    if (m) status.set(`${file}::${[...names.slice(0, indent), m[2]!].join(" > ")}`, m[3] ? "skipped" : m[1] === "ok" ? "ok" : "FAILED");
  }
  return status;
}

export function testModules(ids: string[]): string[] {
  return [...new Set(ids.flatMap((id) => { const m = /\(([\w.]+)\)$/.exec(id); return m ? [m[1]!.split(".").slice(0, -1).join(".")] : []; }))].sort();
}

async function evaluate(inst: Instance, workspace: string, dir: string) {
  const git = (...args: string[]) => exec("git", ["-c", "user.name=eval", "-c", "user.email=eval@local", ...args], { cwd: workspace, maxBuffer: 64_000_000 });
  await git("add", "-A");
  // The exported patch is a record, not the oracle's input: the tests run in the
  // workspace. Keep it bounded when an agent vendors a dependency into the tree.
  let patch = "";
  try { patch = (await git("diff", "--cached", "HEAD", "--", ".", ":!.*")).stdout; }
  catch { patch = `[diff exceeded buffer]\n${(await git("diff", "--cached", "HEAD", "--stat")).stdout.slice(-4000)}`; }
  await writeFile(join(dir, "model.patch"), patch, { mode: 0o600 });
  const touched = goldFiles(patch);
  const gold = goldFiles(inst.patch);
  await writeFile(join(dir, "test.patch"), inst.test_patch);
  let testPatchApplied = true;
  try { await git("apply", join(dir, "test.patch")); } catch { testPatchApplied = false; }
  const f2p = JSON.parse(inst.FAIL_TO_PASS) as string[];
  const p2p = JSON.parse(inst.PASS_TO_PASS) as string[];
  const pytest = inst.runner === "pytest", nodeTest = inst.runner === "node-test";
  const labels = pytest || nodeTest ? (inst.test_files ?? []) : testModules([...f2p, ...p2p]);
  let output = "";
  let testError: string | undefined;
  const t0 = performance.now();
  const status = new Map<string, string>();
  const env = { PATH: process.env.PATH, HOME: join(workspace, ".home"), TMPDIR: join(workspace, ".tmp"), LANG: "en_US.UTF-8", PYTHONDONTWRITEBYTECODE: "1", ...(nodeTest ? { NODE_ENV: "test" } : {}) };
  if (testPatchApplied && labels.length && nodeTest) {
    // One process per file, so every TAP line is attributable to its file.
    for (const file of labels) {
      let out = "";
      try { const r = await exec(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", file], { cwd: workspace, timeout: 600_000, maxBuffer: 256_000_000, env }); out = r.stdout + r.stderr; }
      catch (e: any) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; if (e.killed) testError = "timeout"; }
      output += `\n### ${file}\n${out}`;
      for (const [id, st] of parseNodeTestResults(out, file)) status.set(id, st);
    }
  } else if (testPatchApplied && labels.length) {
    const python = join(workspace, ".venv", "bin", "python");
    const args = pytest ? ["-m", "pytest", ...labels, "-rA", "-q", "--no-header", "-p", "no:cacheprovider", "-o", "addopts="] : ["tests/runtests.py", ...labels, "--parallel", "1", "-v", "2"];
    try {
      const r = await exec(python, args, { cwd: workspace, timeout: 1_200_000, maxBuffer: 256_000_000, env });
      output = r.stdout + r.stderr;
    } catch (e: any) { output = `${e.stdout ?? ""}${e.stderr ?? ""}`; testError = e.killed ? "timeout" : e.code === "ENOENT" ? "no-python" : undefined; }
    for (const [id, st] of pytest ? parsePytestResults(output) : parseDjangoResults(output)) status.set(id, st);
  }
  await writeFile(join(dir, "tests.txt"), output, { mode: 0o600 });
  const f2pStatus = f2p.map(id => ({ id, status: status.get(id) ?? "missing" }));
  const p2pSeen = p2p.map(id => ({ id, status: status.get(id) })).filter(x => x.status);
  const passing = (st: string) => st === "ok" || st.startsWith("skipped") || st === "expected failure";
  const f2pPass = f2p.length > 0 && f2pStatus.every(x => x.status === "ok");
  const p2pRegressions = p2pSeen.filter(x => !passing(x.status!)).length;
  return { patchBytes: Buffer.byteLength(patch), touched, gold, goldTouched: gold.filter(g => touched.includes(g)).length,
    testPatchApplied, labels: labels.length, testError, testMs: Math.round(performance.now() - t0), f2p: f2p.length, f2pFailing: f2pStatus.filter(x => x.status !== "ok").map(x => `${x.id}: ${x.status}`).slice(0, 20),
    f2pPass, p2pSeen: p2pSeen.length, p2pRegressions, resolved: f2pPass && p2pRegressions === 0 };
}

async function job(inst: Instance, arm: Arm) {
  const dir = join(out, inst.instance_id, arm);
  const workspace = join(dir, "project");
  // Resumable: a finished job is reported from disk instead of being rerun.
  const previous = await readFile(join(dir, "result.json"), "utf8").then(t => JSON.parse(t)).catch(() => undefined);
  if (previous) { console.log(`${inst.instance_id.padEnd(22)} ${arm.padEnd(8)} (resumed from disk)`); return previous; }
  const t0 = performance.now();
  await mkdir(dir, { recursive: true });
  await prepareWorkspace(inst, workspace);
  const setupMs = Math.round(performance.now() - t0);
  const run = await runAgent(inst, arm, dir, workspace);
  const evalResult = await evaluate(inst, workspace, dir);
  const result = { instance_id: inst.instance_id, repo: inst.repo, difficulty: inst.difficulty, arm, model: values.model, budgets: { turns: Number(values.turns), tokens: Number(values.tokens), seconds: Number(values.seconds) }, setupMs, ...run, evaluation: evalResult };
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 1), { mode: 0o600 });
  const s = run.byKind.search?.calls ?? 0, rd = run.byKind.read?.calls ?? 0, ed = run.byKind.edit?.calls ?? 0, te = run.byKind.test?.calls ?? 0;
  console.log(`${inst.instance_id.padEnd(22)} ${arm.padEnd(8)} ${run.termination.padEnd(9)} search=${String(s).padStart(2)} read=${String(rd).padStart(2)} edit=${String(ed).padStart(2)} test=${String(te).padStart(2)} | ctx peak=${(run.usage.peakContext / 1000).toFixed(0)}k in+cache=${((run.usage.input + run.usage.cacheRead) / 1000).toFixed(0)}k $${run.usage.estimatedUsd.toFixed(3)} | ${(run.elapsedMs / 1000).toFixed(0)}s | jev=${run.jev.calls} | gold ${evalResult.goldTouched}/${evalResult.gold.length} f2p=${evalResult.f2pPass ? "PASS" : "fail"} p2p-reg=${evalResult.p2pRegressions} → ${evalResult.resolved ? "RESOLVED" : "unresolved"}`);
  return result;
}

const queue = dataset.flatMap(inst => arms.map(arm => ({ inst, arm })));
const results: unknown[] = [];
const workers = Array.from({ length: Number(values.parallel) }, async () => {
  while (queue.length) {
    const next = queue.shift()!;
    try { results.push(await job(next.inst, next.arm)); }
    catch (e) { console.log(`${next.inst.instance_id} ${next.arm} FAILED: ${(e as Error).message}`); results.push({ instance_id: next.inst.instance_id, arm: next.arm, harnessError: String((e as Error).message) }); }
    await writeFile(join(out, "results.json"), JSON.stringify({ model: values.model, arms, records: results }, null, 1));
  }
});
await Promise.all(workers);
console.log(`done: ${results.length} runs → ${join(out, "results.json")}`);
