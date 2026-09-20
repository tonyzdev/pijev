import { appendFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { checkpointSnapshot, type SourceSnapshot } from "./checkpoint.js";
import { filterOutput, auditFinish, PLACEMENTS, REQUIREMENTS, type Placement } from "./placement.js";
import { JevClient, type JevResult } from "../src/jev.js";
import { loadConfig } from "../src/config.js";
import type { DecisionProvider } from "../src/decisions.js";
export interface PlacementRecord {
    kind: "output" | "finish" | "error";
    sequence: number;
    decision?: JevResult;
    continued?: boolean;
    skipped?: string;
    [key: string]: unknown;
}
const textOf = (content: unknown): string => Array.isArray(content) ? content.flatMap(c => c && typeof c === "object" && c.type === "text" ? [String(c.text)] : []).join("\n") : typeof content === "string" ? content : "";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Recognize common verification invocations, not words in read/search arguments. */
export function isVerificationCommand(command: string): boolean {
    return /(?:^|&&|\|\||[;|\n])\s*(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|check|typecheck)\b|(?:npx\s+)?(?:tsc|vitest|jest|pytest)\b|(?:npx\s+)?(?:node|tsx)\b[^\n;&|]*\s--test\b)/.test(command);
}
export function createPlacementExtension(options: {
    policy: Placement;
    cwd: string;
    task: string;
    requirements: string[];
    provider?: DecisionProvider;
    onRecord?: (record: PlacementRecord) => Promise<void>;
}): ExtensionFactory {
    return pi => {
        let initial: SourceSnapshot | undefined, outputs = 0, finishes = 0;
        const observations: string[] = [];
        let lifecycle = new AbortController();
        pi.on("session_start", () => { lifecycle.abort(); lifecycle = new AbortController(); initial = undefined; outputs = 0; finishes = 0; observations.length = 0; });
        pi.on("session_shutdown", () => { lifecycle.abort(); });
        pi.on("before_agent_start", async () => { initial ??= await checkpointSnapshot(options.cwd); });
        pi.on("tool_result", async (event, ctx) => {
            const text = textOf(event.content);
            observations.push(`${event.toolName} ${JSON.stringify(event.input)}\n${text}`.slice(0, 1000));
            if (observations.length > 8)
                observations.shift();
            if (!options.policy.startsWith("output") || outputs >= 8 || event.isError || !["read", "bash"].includes(event.toolName) || !event.content.every(c => c.type === "text"))
                return;
            if (event.toolName === "bash" && isVerificationCommand(String((event.input as { command?: string }).command)))
                return;
            const bytes = Buffer.byteLength(text), chunks = Math.ceil(text.split("\n").length / 12);
            if (bytes < 128 || bytes > 48000 || chunks < 2 || chunks > 64)
                return;
            const sequence = ++outputs, start = performance.now();
            const assistant = ctx.sessionManager.getBranch().findLast(e => e.type === "message" && e.message.role === "assistant");
            const intent = (assistant?.type === "message" && assistant.message.role === "assistant" ? textOf(assistant.message.content) : "") + `\nCurrent tool: ${event.toolName} ${JSON.stringify(event.input)}`;
            const signal = ctx.signal ? AbortSignal.any([ctx.signal, lifecycle.signal]) : lifecycle.signal;
            try {
                const result = await filterOutput({ mode: options.policy === "output-jev" ? "jev" : "local", task: options.task, intent, text, provider: options.provider, signal });
                await options.onRecord?.({ kind: "output", sequence, toolCallId: event.toolCallId, tool: event.toolName, inputBytes: bytes, outputBytes: Buffer.byteLength(result.text), inputHash: hash(text), outputHash: hash(result.text), selected: result.selected, omittedChunks: result.omittedChunks, decision: result.decision, skipped: result.skipped, elapsedMs: Math.round(performance.now() - start) });
                if (!signal.aborted && result.text !== text)
                    return { content: [{ type: "text" as const, text: result.text }] };
            }
            catch {
                await options.onRecord?.({ kind: "error", sequence, skipped: "output_hook_error" });
            }
        });
        pi.on("agent_end", async (event, ctx) => {
            if (!options.policy.startsWith("finish") || finishes >= 2 || lifecycle.signal.aborted || ctx.signal?.aborted)
                return;
            const final = event.messages.findLast(m => m.role === "assistant");
            if (!final || final.role !== "assistant" || final.stopReason !== "stop" || !textOf(final.content).trim())
                return;
            const sequence = ++finishes, start = performance.now();
            const signal = ctx.signal ? AbortSignal.any([ctx.signal, lifecycle.signal]) : lifecycle.signal;
            try {
                const snapshot = await checkpointSnapshot(options.cwd);
                const files = Object.fromEntries([...snapshot].filter(([p, s]) => !initial || initial.get(p) !== s));
                const deletedPaths = [...(initial?.keys() ?? [])].filter(path => !snapshot.has(path));
                const result = await auditFinish({ mode: options.policy === "finish-jev" ? "jev" : "local", task: options.task, requirements: options.requirements, files, deletedPaths, observations, finalText: textOf(final.content), provider: options.provider, signal });
                const continued = sequence === 1 && result.gaps.length > 0 && !signal.aborted;
                await options.onRecord?.({ kind: "finish", sequence, ...result, continued, deletedPaths, files: Object.fromEntries(Object.entries(files).map(([p, s]) => [p, hash(s)])), elapsedMs: Math.round(performance.now() - start) });
                if (continued)
                    pi.sendMessage({ customType: "pijev-placement-review", content: "Before ending, verify the following requirements against the actual implementation and tests. The review has not established sufficient evidence; it is fallible and is not proof of a defect. Fix actual omissions, add meaningful production regression tests where needed, run verification, and then provide the final result. This is the single bounded review continuation.\n" + result.gaps.map((gap, i) => `${i + 1}. ${gap}`).join("\n"), display: true }, { triggerTurn: true, deliverAs: "followUp" });
            }
            catch {
                await options.onRecord?.({ kind: "error", sequence, skipped: "finish_hook_error" });
            }
        });
    };
}
/** Evaluator-only entrypoint. Parent handshake prevents silently missing a treatment. */
const placement: ExtensionFactory = async (pi) => {
    let ready = false, initialized = false;
    pi.on("context", (_event, ctx) => { if (!ready || !initialized)
        ctx.abort(); });
    pi.on("before_provider_request", (_event, ctx) => { if (!ready || !initialized)
        ctx.abort(); });
    pi.on("tool_call", () => { if (!ready || !initialized)
        return { block: true, reason: "Placement experiment is not ready" }; });
    try {
        const cwd = process.env.PIJEV_EVAL_WORKSPACE, log = process.env.PIJEV_PLACEMENT_LOG, policy = process.env.PIJEV_PLACEMENT_POLICY as Placement, taskName = process.env.PIJEV_PLACEMENT_TASK;
        if (!cwd || !log || !PLACEMENTS.includes(policy) || !taskName || !REQUIREMENTS[taskName] || !process.send)
            throw Error("Invalid placement configuration");
        pi.on("session_start", async () => {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => { cleanup(); reject(Error("Placement parent did not acknowledge readiness")); }, 3000);
                const receive = (message: unknown) => { if ((message as {
                    type?: string;
                })?.type === "pijev_placement_ack") {
                    cleanup();
                    ready = true;
                    resolve();
                } };
                const cleanup = () => { clearTimeout(timer); process.off("message", receive); };
                process.on("message", receive);
                process.send!({ type: "pijev_placement_ready", policy }, error => { if (error) {
                    cleanup();
                    reject(error);
                } });
            });
        });
        await createPlacementExtension({ policy, cwd, task: await readFile(join(cwd, "TASK.md"), "utf8"), requirements: REQUIREMENTS[taskName]!, provider: new JevClient({ ...loadConfig(), timeoutMs: 3500 }), onRecord: r => appendFile(log, JSON.stringify(r) + "\n", { mode: 0o600 }) })(pi);
        initialized = true;
    }
    catch {
        pi.on("session_start", (_event, ctx) => { ctx.ui.notify("Placement experiment initialization failed", "error"); });
    }
};
export default placement;
