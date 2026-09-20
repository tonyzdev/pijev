import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createAgentSession, createBashToolDefinition, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../src/config.js";
import { createPijevExtension } from "../src/extension.js";
import { readRecentDecisions } from "../src/telemetry.js";
import { checkWorkspacePath, sandboxProfile, shellEnvironment, shellQuote } from "./sandbox.js";
import { TASKS } from "./tasks.js";
import { installEvalBudget, recordEvalRun, validateBudgets } from "./budget.js";
import { captureSourceProvenance } from "./provenance.js";

const { values } = parseArgs({ options: {
  task: { type: "string" }, mode: { type: "string", default: "plain" },
  model: { type: "string", default: "alibaba/qwen3-coder-next" },
  turns: { type: "string", default: "32" }, seconds: { type: "string", default: "300" },
  tokens: { type: "string", default: "150000" }, list: { type: "boolean", default: false },
  "max-output-tokens": { type: "string", default: "16384" }, briefing: { type: "boolean", default: false },
} });
if (values.list) { console.log(TASKS.map(({ id }) => id).join("\n")); process.exit(0); }
if (process.platform !== "darwin") throw new Error("Live evaluation currently requires macOS sandbox-exec; no unsandboxed fallback is provided.");
const mode = values.mode;
if (mode !== "plain" && mode !== "off" && mode !== "observe" && mode !== "assist") throw new Error("Mode must be plain, off, observe, or assist.");
if (mode === "plain" && values.briefing) throw new Error("--briefing requires off, observe, or assist mode.");
const task = TASKS.find(({ id }) => id === values.task);
if (!task) throw new Error("Select an existing --task (use --list).");
const budgets = validateBudgets({ turns: Number(values.turns), seconds: Number(values.seconds), tokens: Number(values.tokens), maxOutputTokens: Number(values["max-output-tokens"]) });
const mainKey = process.env.AI_GATEWAY_API_KEY?.trim();
if (!mainKey) throw new Error("Set AI_GATEWAY_API_KEY in the harness launch environment.");
const config = loadConfig();
const secrets = [...new Set([mainKey, config.apiKey].filter((key): key is string => Boolean(key)))];
const clean = (value: string) => secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), value);
// Retain credentials only in the provider objects, not subprocess environments.
for (const name of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|BASH_ENV|NODE_OPTIONS/.test(name)) delete process.env[name];

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${task.id}-${mode}-briefing-${values.briefing ? "on" : "off"}`;
const source = await captureSourceProvenance(project);
const output = join(project, ".pijev", "evals", runId);
const cwd = await realpath(await mkdtemp(join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "pijev-task-")));
await mkdir(output, { recursive: true, mode: 0o700 });
await task.setup(cwd);
await Promise.all([mkdir(join(cwd, ".home")), mkdir(join(cwd, ".tmp"))]);
const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
const runtime = await ModelRuntime.create({ authPath: join(output, "home", "auth.json"), modelsPath: null, refreshOnCreate: false });
await runtime.setRuntimeApiKey("vercel-ai-gateway", mainKey);
const model = runtime.getModel("vercel-ai-gateway", values.model!);
if (!model) throw new Error("The requested main model is absent from the pinned Pi catalog.");
let termination = "completed";
let budget!: ReturnType<typeof installEvalBudget>;
const sourceRef = await readFile(join(project, "package.json"), "utf8").then((text) => JSON.parse(text).version as string);
const profile = sandboxProfile(cwd, [await realpath(homedir()), await realpath(project)]);
const control: ExtensionFactory = (pi) => {
  budget = installEvalBudget(pi, budgets);
  pi.registerTool(createBashToolDefinition(cwd, {
    exposeSessionEnvironment: false,
    spawnHook: ({ command }) => ({ cwd, env: shellEnvironment(cwd), command: `/usr/bin/sandbox-exec -p ${shellQuote(profile)} /bin/bash --noprofile --norc -c ${shellQuote(command)}` }),
  }));
  pi.on("tool_call", async (event) => {
    if (["read", "write", "edit"].includes(event.toolName)) {
      const path = (event.input as { path?: unknown }).path;
      if (typeof path !== "string") return { block: true, reason: "A workspace file path is required." };
      try { await checkWorkspacePath(cwd, path); }
      catch { return { block: true, reason: "Evaluation tools may only access task workspace files." }; }
    }
    if (event.toolName === "bash") {
      const input = event.input as { timeout?: number };
      input.timeout = Math.min(input.timeout ?? 30, 30);
    }
  });
};
const factories = mode === "plain" ? [control] : [control, createPijevExtension({ ...config, home: join(output, "home"), mode, sourceBriefing: values.briefing })];
const resources = new DefaultResourceLoader({
  cwd, agentDir: join(output, "home"), settingsManager: settings,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
  agentsFilesOverride: () => ({ agentsFiles: [] }),
  extensionFactories: factories,
});
await resources.reload();
if (resources.getExtensions().errors.length) throw new Error("Evaluation extension failed to load.");
const { session } = await createAgentSession({
  cwd, agentDir: join(output, "home"), model, modelRuntime: runtime, thinkingLevel: "off",
  resourceLoader: resources, settingsManager: settings, sessionManager: SessionManager.inMemory(),
  tools: ["read", "bash", "edit", "write", ...(mode === "plain" ? [] : ["pijev_search"])],
});
await session.bindExtensions({});
const recording = await recordEvalRun(session, join(output, "events.jsonl"), clean, () => { termination = "interrupted"; });
session.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log(JSON.stringify({ event: "tool", turn: budget.snapshot().requests, tool: event.toolName }));
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    const message = event.message;
    if (message.stopReason === "error" && termination === "completed" && budget.snapshot().termination !== "budget") termination = "error";
  }
});
try {
console.log(JSON.stringify({ event: "start", task: task.id, mode, briefing: values.briefing, model: model.id, budgets, source, output, workspace: cwd }));
const start = performance.now();
const timer = setTimeout(() => { if (termination !== "interrupted") termination = "timeout"; void session.abort(); }, budgets.seconds * 1000);
let error: string | undefined;
try {
  await session.prompt(`${task.prompt}\n\nWork autonomously in this repository. Inspect the implementation, make the repair, and run its tests. Do not ask for clarification. Keep changes focused and preserve the public API.`);
} catch (failure) {
  if (termination === "completed") termination = "error";
  error = clean(failure instanceof Error ? failure.message : String(failure));
} finally { clearTimeout(timer); }
const elapsedMs = Math.round(performance.now() - start);
const budgetState = budget.snapshot();
if (budgetState.termination === "budget" && termination !== "timeout" && termination !== "interrupted") termination = "budget";
const trace = session.messages;
await writeFile(join(output, "trace.json"), clean(JSON.stringify(trace, null, 2)), { mode: 0o600 });
session.dispose();
const acceptance = await task.verify(cwd);
const decisions = await readRecentDecisions(join(output, "home"), 500);
const jev = decisions.reduce((sum, row) => ({
  calls: sum.calls + 1, network: sum.network + Number(row.status === "ok" && !row.cached),
  fallbacks: sum.fallbacks + Number(row.status === "fallback"),
  input: sum.input + (row.inputTokens ?? 0), output: sum.output + (row.outputTokens ?? 0),
  latencyMs: sum.latencyMs + row.latencyMs,
}), { calls: 0, network: 0, fallbacks: 0, input: 0, output: 0, latencyMs: 0 });
const sourceAtEnd = await captureSourceProvenance(project);
await recording.flush();
const result = { runId, version: sourceRef, source, sourceAtEnd, sourceChangedDuringRun: source.sourceDigest !== sourceAtEnd.sourceDigest || source.builtRuntimeDigest !== sourceAtEnd.builtRuntimeDigest || source.head !== sourceAtEnd.head, task: task.id, mode, briefing: values.briefing, model: model.id, budgets, termination, ...(budgetState.budgetReason ? { budgetReason: budgetState.budgetReason } : {}), acceptance, turns: budgetState.requests, requests: budgetState.requests, tokens: budgetState.tokens, calls: budgetState.calls, usage: budgetState.usage, jev, elapsedMs, traceWriteFailed: recording.writeFailed, ...(error ? { error } : {}), workspace: cwd };
await writeFile(join(output, "result.json"), clean(JSON.stringify(result, null, 2)), { mode: 0o600 });
console.log(clean(JSON.stringify({ event: "result", ...result })));
} finally { await recording.close(); }
