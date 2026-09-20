import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { shellEnvironment } from "./sandbox.js";
import { validateBudgets, type EvalBudgetSnapshot, type EvalUsage } from "./budget.js";
import { captureSourceProvenance } from "./provenance.js";
import { readRecentDecisions } from "../src/telemetry.js";

const { values } = parseArgs({ options: {
  mode: { type: "string", default: "assist" }, model: { type: "string", default: "alibaba/qwen3-coder-next" },
  seconds: { type: "string", default: "360" }, turns: { type: "string", default: "36" },
  tokens: { type: "string", default: "180000" }, "max-output-tokens": { type: "string", default: "16384" },
  briefing: { type: "boolean", default: false },
} });
const budgets = validateBudgets({ turns: Number(values.turns), seconds: Number(values.seconds), tokens: Number(values.tokens), maxOutputTokens: Number(values["max-output-tokens"]) });
if (process.platform !== "darwin") throw new Error("Real CLI evaluation currently requires macOS sandbox-exec.");
if (values.mode !== "assist" && values.mode !== "observe" && values.mode !== "off") throw new Error("Use --mode assist, observe, or off.");
const key = process.env.AI_GATEWAY_API_KEY;
if (!key) throw new Error("Load AI_GATEWAY_API_KEY in the harness environment.");
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Capture this in the parent before shellEnvironment rewrites the child's HOME.
const protectedHome = await realpath(homedir());
const runId = `${new Date().toISOString().replaceAll(":", "-")}-decision-lineage-${values.mode}-briefing-${values.briefing ? "on" : "off"}`;
const source = await captureSourceProvenance(project);
const output = join(project, ".pijev", "evals", runId);
const root = await realpath(await mkdtemp(join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "pijev-df-")));
const cwd = join(root, "project");
const exec = promisify(execFile);
await mkdir(output, { recursive: true, mode: 0o700 });
// A pinned public revision, with no local .env, sessions, research or unstaged changes.
await exec("git", ["clone", "--quiet", "--no-hardlinks", "--local", project, cwd]);
await exec("git", ["checkout", "--quiet", "4e1cdef"], { cwd });
const baseline = (await exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
await exec("git", ["remote", "remove", "origin"], { cwd });
await Promise.all([mkdir(join(cwd, ".home")), mkdir(join(cwd, ".tmp"))]);
await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd, timeout: 120000, maxBuffer: 1024 * 1024 });
const prompt = `Implement a real observability improvement in this PiJev repository. Today decision journals record a process's calls but cannot reliably associate them with the actual Pi session or the user turn. Add session and per-user-turn identifiers to newly recorded Jev decision metadata, sourced from the actual runtime. Multiple evaluations within one turn must share the same turn identifier; a later user prompt must receive a different one; switching sessions must not reuse the old session identity. Keep old journal files readable. Keep metadata free of prompts, file contents, user text and credentials. Update the decisions CLI presentation so a user can identify the session/turn without losing current fields, and document the change. Add meaningful automated tests including at least one test through the actual Pi SDK that covers more than one user turn. Preserve assist/observe/off semantics and cancellation. Do not publish or commit. Inspect the implementation, implement the complete feature, then run type checks, tests and build. Work autonomously; do not ask for clarification.`;
await writeFile(join(output, "task.txt"), prompt, { mode: 0o600 });
const trace = createWriteStream(join(output, "cli-trace.jsonl"), { mode: 0o600 });
const errors = createWriteStream(join(output, "stderr.txt"), { mode: 0o600 });
const child = spawn(process.execPath, [
  join(project, "bin", "pijev.mjs"), "--jev-mode", values.mode,
  "--mode", "json", "--print", "--provider", "vercel-ai-gateway", "--model", values.model!, "--thinking", "off",
  "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-extensions", "--offline",
  "--extension", join(project, "eval", "cli-control.ts"),
  "--session-dir", join(output, "sessions"), prompt,
], {
  cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...shellEnvironment(cwd), AI_GATEWAY_API_KEY: key, PIJEV_JEV_PROVIDER: "vercel", PIJEV_HOME: join(output, "home"),
    PIJEV_EVAL_WORKSPACE: cwd, PIJEV_EVAL_STATS: join(output, "control.json"), PIJEV_EVAL_TURNS: values.turns,
    PIJEV_EVAL_PROTECTED_HOME: protectedHome,
    PIJEV_EVAL_TOKENS: String(budgets.tokens), PIJEV_EVAL_SECONDS: String(budgets.seconds), PIJEV_EVAL_MAX_OUTPUT_TOKENS: String(budgets.maxOutputTokens),
    PIJEV_SOURCE_BRIEFING: values.briefing ? "1" : "0",
    PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1",
  },
});
let pending = "";
let pendingError = "";
let turns = 0;
let assistantMessages = 0;
let providerResponses = 0;
let reportedTokens = 0;
const observedUsage: EvalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estimatedUsd: 0 };
const calls: Record<string, number> = {};
let timedOut = false;
let interrupted = false;
let backupBudgetStop = false;
let modelError = false;
let forcedKill: ReturnType<typeof setTimeout> | undefined;
const stopChild = () => {
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  forcedKill ??= setTimeout(() => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1000);
};
const interrupt = () => { interrupted = true; stopChild(); };
process.on("SIGTERM", interrupt);
const clean = (text: string) => text.replaceAll(key, "[redacted]");
const start = performance.now();
console.log(JSON.stringify({ event: "start", runId, mode: values.mode, briefing: values.briefing, model: values.model, budgets, baseline, source, workspace: cwd, output, pid: child.pid }));
child.stdout.setEncoding("utf8");
child.stdout.on("data", (data: string) => {
  pending += data;
  let newline: number;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const line = clean(pending.slice(0, newline)); pending = pending.slice(newline + 1);
    trace.write(`${line}\n`);
    try {
      const event = JSON.parse(line);
      if (event.type === "turn_start") turns++;
      if (event.type === "tool_execution_start") {
        calls[event.toolName] = (calls[event.toolName] ?? 0) + 1;
        console.log(JSON.stringify({ event: "tool", turn: turns, tool: event.toolName }));
      }
      if (event.type === "message_end" && event.message?.role === "assistant") {
        assistantMessages++;
        const usage = event.message.usage;
        const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
        reportedTokens += count(usage?.totalTokens);
        observedUsage.input += count(usage?.input);
        observedUsage.output += count(usage?.output);
        observedUsage.cacheRead += count(usage?.cacheRead);
        observedUsage.cacheWrite += count(usage?.cacheWrite);
        observedUsage.estimatedUsd += count(usage?.cost?.total);
        if (event.message.stopReason !== "aborted" || count(usage?.totalTokens) > 0) providerResponses++;
        if (event.message.stopReason === "error") { modelError = true; console.log(JSON.stringify({ event: "model_error" })); }
        // Backup only: the in-process budget must prevent this additional response.
        if (providerResponses > budgets.turns) { backupBudgetStop = true; stopChild(); }
      }
    } catch { /* CLI startup text is retained in the raw trace. */ }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (data: string) => {
  pendingError += data;
  const newline = pendingError.lastIndexOf("\n");
  if (newline >= 0) { errors.write(clean(pendingError.slice(0, newline + 1))); pendingError = pendingError.slice(newline + 1); }
});
const timer = setTimeout(() => { timedOut = true; stopChild(); }, budgets.seconds * 1000);
let spawnFailed = false;
let exitSignal: NodeJS.Signals | null = null;
const exitCode = await new Promise<number | null>((resolveExit) => { child.once("error", () => { spawnFailed = true; resolveExit(null); }); child.once("close", (code, signal) => { exitSignal = signal; resolveExit(code); }); });
clearTimeout(timer);
if (forcedKill) clearTimeout(forcedKill);
if (pending) trace.write(clean(pending));
if (pendingError) errors.write(clean(pendingError));
await Promise.all([new Promise<void>((done) => trace.end(done)), new Promise<void>((done) => errors.end(done))]);
const control = await readFile(join(output, "control.json"), "utf8").then((text) => JSON.parse(text) as EvalBudgetSnapshot & { isolationError?: boolean }).catch(() => undefined);
const decisions = await readRecentDecisions(join(output, "home"), 500);
const jev = decisions.reduce((sum, row) => ({ calls: sum.calls + 1, successfulNetworkCalls: sum.successfulNetworkCalls + Number(row.status === "ok" && !row.cached), cacheHits: sum.cacheHits + Number(row.cached), fallbacks: sum.fallbacks + Number(row.status === "fallback"), input: sum.input + (row.inputTokens ?? 0), output: sum.output + (row.outputTokens ?? 0), latencyMs: sum.latencyMs + row.latencyMs }), { calls: 0, successfulNetworkCalls: 0, cacheHits: 0, fallbacks: 0, input: 0, output: 0, latencyMs: 0 });
const sourceAtEnd = await captureSourceProvenance(project);
const termination = timedOut ? "timeout" : interrupted || exitSignal === "SIGTERM" ? "interrupted" : backupBudgetStop || control?.termination === "budget" ? "budget" : spawnFailed || modelError || control?.isolationError || exitCode !== 0 ? "error" : "completed";
const result = { runId, mode: values.mode, briefing: values.briefing, model: values.model, baseline, source, sourceAtEnd, sourceChangedDuringRun: source.sourceDigest !== sourceAtEnd.sourceDigest || source.builtRuntimeDigest !== sourceAtEnd.builtRuntimeDigest || source.head !== sourceAtEnd.head, budgets, termination, budgetReason: control?.budgetReason ?? (backupBudgetStop ? "parent_request_guard" : undefined), requests: control?.requests ?? null, assistantMessages, providerResponses, tokens: control?.tokens ?? reportedTokens, usage: control?.usage ?? observedUsage, calls, jev, workspace: cwd, output, exitCode, exitSignal, timedOut, backupBudgetStop, isolationError: Boolean(control?.isolationError), controlStatsAvailable: !!control, elapsedMs: Math.round(performance.now() - start) };
await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ event: "result", ...result }));
process.off("SIGTERM", interrupt);
