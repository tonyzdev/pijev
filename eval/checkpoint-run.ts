import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile, lstat, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { shellEnvironment } from "./sandbox.js";
import { validateBudgets, type EvalBudgetSnapshot, type EvalUsage } from "./budget.js";
import { captureSourceProvenance } from "./provenance.js";
import { readRecentDecisions } from "../src/telemetry.js";
import { loadConfig } from "../src/config.js";
import { JevClient } from "../src/jev.js";
import { dependencyEvidence, formatDependencyEvidence } from "./dependency-evidence.js";
import { dependencyApiEvidence, formatDependencyApiEvidence } from "./dependency-api-evidence.js";
import { projectSourceEvidence, formatProjectSourceEvidence } from "./project-source-evidence.js";
import { PLACEMENTS, type Placement } from "./placement.js";

const { values } = parseArgs({ options: {
  mode: { type: "string", default: "off" }, model: { type: "string", default: "anthropic/claude-sonnet-4.6" },
  checkpoint: { type: "string", default: "manual" }, thinking: { type: "string", default: "medium" },
  seconds: { type: "string", default: "480" }, turns: { type: "string", default: "48" },
  tokens: { type: "string", default: "1600000" }, "max-output-tokens": { type: "string", default: "16384" },
  briefing: { type: "boolean", default: false },
  "dependency-evidence": { type: "string", default: "none" },
  "dependency-policy": { type: "string", default: "windows" },
  "project-evidence": { type: "string", default: "none" },
  placement: { type: "string", default: "none" },
  task: { type: "string", default: "attribution" },
  sample: { type: "string", default: "1" },
} });
const budgets = validateBudgets({ turns: Number(values.turns), seconds: Number(values.seconds), tokens: Number(values.tokens), maxOutputTokens: Number(values["max-output-tokens"]) });
if (values.mode !== "assist" && values.mode !== "observe" && values.mode !== "off") throw new Error("Use --mode assist, observe, or off.");
if (values.mode !== "off" || values.briefing || !["manual", "dependencies", "jev"].includes(values.checkpoint!)) throw new Error("Checkpoint comparison requires --mode off, no briefing, and a valid --checkpoint mode.");
const evidenceMode = values["dependency-evidence"]!;
if (!["none", "lexical", "jev"].includes(evidenceMode) || (evidenceMode !== "none" && values.checkpoint !== "manual")) throw new Error("Dependency evidence requires none, lexical or jev and manual checkpoints.");
if (!["windows", "api"].includes(values["dependency-policy"]!) || (values["dependency-policy"] === "api" && evidenceMode === "none")) throw new Error("Use --dependency-policy windows, or api with lexical/jev evidence.");
const apiEvidence = values["dependency-policy"] === "api";
const projectEvidenceMode = values["project-evidence"]!;
if (!["none", "lexical", "jev"].includes(projectEvidenceMode) || (projectEvidenceMode !== "none" && (evidenceMode !== "none" || values.checkpoint !== "manual"))) throw new Error("Project evidence requires lexical/jev, manual checkpoints, and no dependency evidence.");
const placementPolicy = values.placement!;
if (placementPolicy !== "none" && !PLACEMENTS.includes(placementPolicy as Placement)) throw new Error("Invalid placement policy");
if (placementPolicy !== "none" && (evidenceMode !== "none" || projectEvidenceMode !== "none" || values.checkpoint !== "manual")) throw new Error("Placement must be isolated from other evidence and checkpoint policies");
if (placementPolicy === "checkpoint-local") values.checkpoint = "dependencies";
if (placementPolicy === "checkpoint-jev") values.checkpoint = "jev";
if (values.task !== "attribution" && values.task !== "session-mode") throw new Error("Use --task attribution or session-mode.");
if (!/^[1-9]\d{0,2}$/.test(values.sample!)) throw new Error("Use a positive --sample label from 1 to 999.");
if (process.platform !== "darwin") throw new Error("Real CLI evaluation currently requires macOS sandbox-exec.");
const fixtureDirectory = values.task === "attribution" ? "checkpoint-fixture" : "session-mode-fixture";
const { prepareWorkspace } = await import(`./${fixtureDirectory}/verify.js`) as typeof import("./checkpoint-fixture/verify.js");
const key = process.env.AI_GATEWAY_API_KEY;
if (!key) throw new Error("Load AI_GATEWAY_API_KEY in the harness environment.");
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Capture this in the parent before shellEnvironment rewrites the child's HOME.
const protectedHome = await realpath(homedir());
const runId = placementPolicy !== "none" ? `${new Date().toISOString().replaceAll(":", "-")}-${values.task}-${values.sample}-placement-${placementPolicy}` : `${new Date().toISOString().replaceAll(":", "-")}-${values.task === "attribution" ? "" : `${values.task}-${values.sample}-`}${projectEvidenceMode !== "none" ? `project-${projectEvidenceMode}` : evidenceMode === "none" ? `checkpoint-${values.checkpoint}` : `${apiEvidence ? "api" : "dependency"}-${evidenceMode}`}`;
const source = await captureSourceProvenance(project);
const output = join(project, ".pijev", "evals", runId);
const root = await realpath(await mkdtemp(join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "pijev-df-")));
const cwd = join(root, "project");
const exec = promisify(execFile);
await mkdir(output, { recursive: true, mode: 0o700 });
// A pinned public revision, with no local .env, sessions, research or unstaged changes.
await prepareWorkspace(cwd);
const baseline = (await exec("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
if ((await lstat(join(cwd, "node_modules"))).isSymbolicLink()) await rm(join(cwd, "node_modules"));
await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd, timeout: 120000, maxBuffer: 1024 * 1024 });
const task = await readFile(join(project, "eval", fixtureDirectory, "task.md"), "utf8");
const evidence = evidenceMode === "none" ? undefined : await (apiEvidence ? dependencyApiEvidence : dependencyEvidence)({
  cwd, query: task, mode: evidenceMode as "lexical" | "jev",
  provider: evidenceMode === "jev" ? new JevClient(loadConfig({ ...process.env, PIJEV_JEV_PROVIDER: "vercel" })) : undefined,
  signal: AbortSignal.timeout(15000),
});
if (evidence) await writeFile(join(output, "dependency-evidence.json"), JSON.stringify(evidence, null, 2), { mode: 0o600 });
const formattedEvidence = evidence ? "policy" in evidence ? formatDependencyApiEvidence(evidence) : formatDependencyEvidence(evidence) : "";
let projectEvidence: Awaited<ReturnType<typeof projectSourceEvidence>> | undefined;
const preprocessingStarted = performance.now();
try {
  projectEvidence = projectEvidenceMode === "none" ? undefined : await projectSourceEvidence({
    cwd, query: task, mode: projectEvidenceMode as "lexical" | "jev",
    provider: projectEvidenceMode === "jev" ? new JevClient({ ...loadConfig({ ...process.env, PIJEV_JEV_PROVIDER: "vercel" }), timeoutMs: 10000 }) : undefined,
    signal: AbortSignal.timeout(45000),
    onBatch: async (batch, index) => { await writeFile(join(output, `project-batch-${index}.json`), JSON.stringify(batch, null, 2), { mode: 0o600 }); },
  });
} catch (error) {
  // Preserve a terminal diagnostic even if no main-model process was started.
  // Already completed batch files retain paid usage; never return a partial ranking.
  const terminal = { runId, task: values.task, sample: Number(values.sample), projectEvidenceMode, termination: "preprocessing_error", errorName: error instanceof Error ? error.name : "unknown", source, baseline, workspace: cwd, elapsedMs: Math.round(performance.now() - preprocessingStarted), requests: 0 };
  await writeFile(join(output, "preprocessing-terminal.json"), JSON.stringify(terminal, null, 2), { mode: 0o600 });
  throw new Error(`Project preprocessing failed; terminal and completed batch diagnostics saved in ${output}`);
}
if (projectEvidence) await writeFile(join(output, "project-evidence.json"), JSON.stringify(projectEvidence, null, 2), { mode: 0o600 });
const prompt = task + "\nWork autonomously. Inspect and fix the implementation, run type checks, the full test suite and build, and document the change. Do not publish or commit." + (evidence ? `\n\n${formattedEvidence}` : "") + (projectEvidence ? `\n\n${formatProjectSourceEvidence(projectEvidence)}` : "");
await writeFile(join(output, "task.txt"), prompt, { mode: 0o600 });
const trace = createWriteStream(join(output, "cli-trace.jsonl"), { mode: 0o600 });
const errors = createWriteStream(join(output, "stderr.txt"), { mode: 0o600 });
const child = spawn(process.execPath, [
  join(project, "bin", "pijev.mjs"), "--jev-mode", values.mode,
  "--mode", "json", "--print", "--provider", "vercel-ai-gateway", "--model", values.model!, "--thinking", values.thinking!,
  "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-extensions", "--offline",
  "--extension", join(project, "eval", "cli-control.ts"),
  "--extension", join(project, "eval", "checkpoint-extension.ts"),
  ...(placementPolicy !== "none" ? ["--extension", join(project, "eval", "placement-extension.ts")] : []),
  "--session-dir", join(output, "sessions"), prompt,
], {
  cwd, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
  env: {
    ...shellEnvironment(cwd), AI_GATEWAY_API_KEY: key, PIJEV_JEV_PROVIDER: "vercel", PIJEV_HOME: join(output, "home"),
    PIJEV_EVAL_WORKSPACE: cwd, PIJEV_EVAL_STATS: join(output, "control.json"), PIJEV_EVAL_TURNS: values.turns,
    PIJEV_EVAL_PROTECTED_HOME: protectedHome,
    PIJEV_PLACEMENT_POLICY: placementPolicy, PIJEV_PLACEMENT_TASK: values.task, PIJEV_PLACEMENT_LOG: join(output, "placements.jsonl"),
    PIJEV_CHECKPOINT_MODE: values.checkpoint, PIJEV_CHECKPOINT_LOG: join(output, "checkpoints.jsonl"),
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
let checkpointReady = false;
let placementReady = placementPolicy === "none";
let checkpointStartupError = false;
let stopping = false;
const checkpointGroups = new Set<number>();
const killCheckpoint = (pid: number) => { try { process.kill(-pid, "SIGKILL"); } catch {} };
let forcedKill: ReturnType<typeof setTimeout> | undefined;
const stopChild = () => {
  stopping = true;
  for (const pid of checkpointGroups) killCheckpoint(pid);
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  forcedKill ??= setTimeout(() => { if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1000);
};
const interrupt = () => { interrupted = true; stopChild(); };
process.on("SIGTERM", interrupt);
child.on("message", (message) => {
  const event = message as { type?: string; mode?: string; policy?: string; phase?: string; pid?: number };
  if (event.type === "pijev_placement_ready" && event.policy === placementPolicy) { placementReady = true; child.send({ type: "pijev_placement_ack" }); }
  if (event.type === "pijev_checkpoint_ready" && event.mode === values.checkpoint) {
    checkpointReady = true;
    child.send({ type: "pijev_checkpoint_ack" });
  }
  if (event.type === "pijev_checkpoint_process" && Number.isSafeInteger(event.pid) && event.pid! > 0) {
    if (event.phase === "start") { checkpointGroups.add(event.pid!); if (stopping) killCheckpoint(event.pid!); }
    else if (event.phase === "stop") checkpointGroups.delete(event.pid!);
  }
});
const clean = (text: string) => text.replaceAll(key, "[redacted]");
const start = performance.now();
console.log(JSON.stringify({ event: "start", runId, task: values.task, sample: Number(values.sample), mode: values.mode, evidenceMode, projectEvidenceMode, placementPolicy, evidencePolicy: values["dependency-policy"], briefing: values.briefing, model: values.model, budgets, baseline, source, workspace: cwd, output, pid: child.pid }));
child.stdout!.setEncoding("utf8");
child.stdout!.on("data", (data: string) => {
  pending += data;
  let newline: number;
  while ((newline = pending.indexOf("\n")) >= 0) {
    const line = clean(pending.slice(0, newline)); pending = pending.slice(newline + 1);
    trace.write(`${line}\n`);
    try {
      const event = JSON.parse(line);
      if (event.type === "turn_start") {
        turns++;
        if (!checkpointReady || !placementReady) { checkpointStartupError = true; stopChild(); }
      }
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
child.stderr!.setEncoding("utf8");
child.stderr!.on("data", (data: string) => {
  pendingError += data;
  const newline = pendingError.lastIndexOf("\n");
  if (newline >= 0) { errors.write(clean(pendingError.slice(0, newline + 1))); pendingError = pendingError.slice(newline + 1); }
});
const timer = setTimeout(() => { timedOut = true; stopChild(); }, budgets.seconds * 1000);
let spawnFailed = false;
let exitSignal: NodeJS.Signals | null = null;
const exitCode = await new Promise<number | null>((resolveExit) => { child.once("error", () => { spawnFailed = true; resolveExit(null); }); child.once("close", (code, signal) => { exitSignal = signal; resolveExit(code); }); });
stopping = true;
for (const pid of checkpointGroups) killCheckpoint(pid);
clearTimeout(timer);
if (forcedKill) clearTimeout(forcedKill);
if (pending) trace.write(clean(pending));
if (pendingError) errors.write(clean(pendingError));
await Promise.all([new Promise<void>((done) => trace.end(done)), new Promise<void>((done) => errors.end(done))]);
const control = await readFile(join(output, "control.json"), "utf8").then((text) => JSON.parse(text) as EvalBudgetSnapshot & { isolationError?: boolean }).catch(() => undefined);
const decisions = await readRecentDecisions(join(output, "home"), 500);
const jev = decisions.reduce((sum, row) => ({ calls: sum.calls + 1, successfulNetworkCalls: sum.successfulNetworkCalls + Number(row.status === "ok" && !row.cached), cacheHits: sum.cacheHits + Number(row.cached), fallbacks: sum.fallbacks + Number(row.status === "fallback"), input: sum.input + (row.inputTokens ?? 0), output: sum.output + (row.outputTokens ?? 0), latencyMs: sum.latencyMs + row.latencyMs }), { calls: 0, successfulNetworkCalls: 0, cacheHits: 0, fallbacks: 0, input: 0, output: 0, latencyMs: 0 });
const checkpointRecords = await readFile(join(output, "checkpoints.jsonl"), "utf8").then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))).catch(() => []);
const checkpoint = { mode: values.checkpoint, ready: checkpointReady, startupError: checkpointStartupError, records: checkpointRecords.length, executed: checkpointRecords.filter((row) => row.execution).length, scheduledFiles: checkpointRecords.flatMap((row) => row.selected).length, executionMs: checkpointRecords.reduce((sum, row) => sum + (row.execution?.elapsedMs ?? 0), 0), decisions: checkpointRecords.filter((row) => row.decision).length, decisionMs: checkpointRecords.reduce((sum, row) => sum + (row.decision?.latencyMs ?? 0), 0), inputTokens: checkpointRecords.reduce((sum, row) => sum + (row.decision?.inputTokens ?? 0), 0), outputTokens: checkpointRecords.reduce((sum, row) => sum + (row.decision?.outputTokens ?? 0), 0) };
const sourceAtEnd = await captureSourceProvenance(project);
const termination = checkpointStartupError ? "error" : timedOut ? "timeout" : interrupted || exitSignal === "SIGTERM" ? "interrupted" : backupBudgetStop || control?.termination === "budget" ? "budget" : spawnFailed || modelError || !checkpointReady || !placementReady || !control?.requests || control?.isolationError || exitCode !== 0 ? "error" : "completed";
const result = { runId, checkpoint, thinking: values.thinking, mode: values.mode, briefing: values.briefing, model: values.model, baseline, source, sourceAtEnd, sourceChangedDuringRun: source.sourceDigest !== sourceAtEnd.sourceDigest || source.builtRuntimeDigest !== sourceAtEnd.builtRuntimeDigest || source.head !== sourceAtEnd.head, budgets, termination, budgetReason: control?.budgetReason ?? (backupBudgetStop ? "parent_request_guard" : undefined), requests: control?.requests ?? null, assistantMessages, providerResponses, tokens: control?.tokens ?? reportedTokens, usage: control?.usage ?? observedUsage, calls, jev, workspace: cwd, output, exitCode, exitSignal, timedOut, backupBudgetStop, isolationError: Boolean(control?.isolationError), controlStatsAvailable: !!control, elapsedMs: Math.round(performance.now() - start) };
const evidenceSummary = !evidence ? { mode: "none" } : "policy" in evidence
  ? { mode: evidenceMode, ...evidence, pool: undefined, candidates: evidence.candidates.map(({ excerpts, ...unit }) => ({ ...unit, excerpts: excerpts.map(({ excerpt, ...span }) => ({ ...span, bytes: Buffer.byteLength(excerpt) })) })) }
  : { mode: evidenceMode, policy: "windows", ...evidence, candidates: evidence.candidates.map(({path,startLine,excerpt})=>({path,startLine,bytes:Buffer.byteLength(excerpt)})), windowPool: undefined };
const placementRecords = await readFile(join(output, "placements.jsonl"), "utf8").then(text => text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))).catch(() => []);
const summary = { ...result, placement: { policy: placementPolicy, ready: placementReady, records: placementRecords }, task: values.task, sample: Number(values.sample), dependencyEvidence: evidenceSummary, projectEvidence, evidenceAndAgentElapsedMs: result.elapsedMs + (evidence?.elapsedMs ?? 0) + (projectEvidence?.elapsedMs ?? 0) };
await writeFile(join(output, "result.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ event: "result", ...summary }));
process.off("SIGTERM", interrupt);
