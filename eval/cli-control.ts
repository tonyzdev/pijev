import { realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createBashToolDefinition, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { checkWorkspacePath, sandboxProfile, shellEnvironment, shellQuote } from "./sandbox.js";
import { installEvalBudget, validateBudgets, type EvalBudgets } from "./budget.js";

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Explicitly loaded only by the real-CLI dogfood runner, never shipped as a product extension. */
const control: ExtensionFactory = async (pi) => {
  const workspace = process.env.PIJEV_EVAL_WORKSPACE;
  const statsPath = process.env.PIJEV_EVAL_STATS;
  let cwd: string;
  let profile: string;
  let budgets: EvalBudgets;
  try {
    const protectedHome = process.env.PIJEV_EVAL_PROTECTED_HOME;
    if (!workspace || !statsPath || !protectedHome || !isAbsolute(protectedHome) || process.platform !== "darwin") throw new Error("Invalid isolation configuration.");
    cwd = await realpath(workspace);
    const actualHome = await realpath(protectedHome);
    // HOME in the CLI child intentionally points into the task; never derive
    // security roots from it. The development checkout is protected separately.
    const developmentRepository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
    if (!(await stat(actualHome)).isDirectory() || inside(cwd, actualHome) || inside(cwd, developmentRepository)) throw new Error("Invalid protection roots.");
    // The repository's HTTP fixtures need loopback. External network remains denied.
    const allowRead = await Promise.all((process.env.PIJEV_EVAL_ALLOW_READ ?? "").split(":").filter(Boolean).map((root) => realpath(root)));
    if (allowRead.some((root) => inside(root, actualHome) || inside(root, developmentRepository) || inside(actualHome, root) || inside(developmentRepository, root))) throw new Error("Allowed read roots must not overlap protected roots.");
    profile = sandboxProfile(cwd, [actualHome, developmentRepository], { allowLoopback: true, allowRead });
    budgets = validateBudgets({
      turns: Number(process.env.PIJEV_EVAL_TURNS ?? 36), seconds: Number(process.env.PIJEV_EVAL_SECONDS ?? 360),
      tokens: Number(process.env.PIJEV_EVAL_TOKENS ?? 180000), maxOutputTokens: Number(process.env.PIJEV_EVAL_MAX_OUTPUT_TOKENS ?? 16384),
    });
  } catch {
    // Pi skips extensions whose factory throws. Keep this extension installed
    // and deny execution instead of accidentally exposing the built-in tools.
    pi.on("context", (_event, ctx) => { ctx.abort(); });
    pi.on("before_provider_request", (_event, ctx) => { ctx.abort(); });
    pi.on("tool_call", () => ({ block: true, reason: "Evaluation isolation is not configured; all tools are disabled." }));
    pi.on("session_start", (_event, ctx) => { ctx.ui.notify("Evaluation isolation is not configured; execution is disabled.", "error"); });
    pi.on("session_shutdown", async () => { if (statsPath) await writeFile(statsPath, JSON.stringify({ isolationError: true, termination: "error", requests: 0, tokens: 0 }), { mode: 0o600 }); });
    return;
  }
  const budget = installEvalBudget(pi, budgets);
  // Pi advertises documentation beside the executable. This runner executes
  // the development build against a separate clone with its own dependencies;
  // keep those hints inside the same workspace as the agent's tools.
  const installedSdk = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  const workspaceSdk = resolve(cwd, "node_modules", "@earendil-works", "pi-coding-agent");
  pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt.replaceAll(installedSdk, workspaceSdk) }));
  pi.registerTool(createBashToolDefinition(cwd, {
    exposeSessionEnvironment: false,
    spawnHook: ({ command }) => ({ cwd, env: shellEnvironment(cwd), command: `/usr/bin/sandbox-exec -p ${shellQuote(profile)} /bin/bash --noprofile --norc -c ${shellQuote(command)}` }),
  }));
  pi.on("tool_call", async (event) => {
    if (["read", "write", "edit"].includes(event.toolName)) {
      const path = (event.input as { path?: unknown }).path;
      if (typeof path !== "string") return { block: true, reason: "A task workspace path is required." };
      try { await checkWorkspacePath(cwd, path); }
      catch { return { block: true, reason: "Evaluation file tools are restricted to the task workspace." }; }
    }
    if (event.toolName === "bash") {
      const input = event.input as { timeout?: number };
      input.timeout = Math.min(input.timeout ?? 45, 45);
    }
  });
  pi.on("session_shutdown", async () => {
    await writeFile(statsPath, JSON.stringify(budget.snapshot()), { mode: 0o600 });
  });
};
export default control;
