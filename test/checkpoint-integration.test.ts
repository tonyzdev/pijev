import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createCheckpointExtension, type CheckpointRecord } from "../eval/checkpoint-extension.js";

for (const condition of ["manual", "dependencies", "jev", "cancel", "capped"] as const) {
test(`actual Pi checkpoint: ${condition} after an edit batch`, { skip: process.platform !== "darwin", timeout: 10000 }, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pijev-cpi-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const path of ["src", "test", ".home", ".tmp"]) await mkdir(join(cwd, path));
  await writeFile(join(cwd, "src/a.mjs"), "export const value = 1;\n");
  await writeFile(join(cwd, "src/b.mjs"), "export const value = 1;\n");
  await writeFile(join(cwd, "test/a.test.mjs"), "import test from 'node:test'; test('unselected',()=>{});\n");
  await writeFile(join(cwd, "test/b.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/b.mjs'; test('fresh edited value',()=>assert.equal(value,2));\n");
  let calls = 0, decisions = 0;
  const payloads: string[] = [];
  const records: CheckpointRecord[] = [];
  let entered!: () => void;
  const entering = new Promise<void>((resolve) => { entered = resolve; });
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += String(chunk);
    payloads.push(body); calls++;
    const toolCalls = calls === 1 ? ["a", "b"].map((name, index) => ({ index, id: `edit_${name}`, type: "function", function: { name: "write", arguments: JSON.stringify({ path: `src/${name}.mjs`, content: "export const value = 2;\n" }) } })) : calls === 2 ? [{ index: 0, id: "second", type: "function", function: condition === "capped" ? { name: "write", arguments: JSON.stringify({ path: "src/a.mjs", content: "export const value = 3;\n" }) } : { name: "read", arguments: JSON.stringify({ path: "src/a.mjs" }) } }] : undefined;
    const delta = toolCalls ? { role: "assistant", tool_calls: toolCalls } : { role: "assistant", content: "Complete." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [part, finish] of [[delta, null], [{}, toolCalls ? "tool_calls" : "stop"]]) res.write(`data: ${JSON.stringify({ id: `m${calls}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const home = join(cwd, ".home");
  const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("fixture", { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 2000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const extension = createCheckpointExtension({ mode: condition === "cancel" || condition === "capped" ? "jev" : condition, maxCheckpoints: condition === "capped" ? 1 : undefined, cwd, protectedRoots: [], limit: 1, onRecord: (record) => { records.push(record); }, provider: { evaluate: async (_state, _questions, signal) => {
    decisions++;
    if (condition === "cancel") {
      entered();
      await new Promise<void>((resolve) => { if (signal?.aborted) resolve(); else signal?.addEventListener("abort", () => resolve(), { once: true }); });
      return { status: "fallback", reason: "cancelled", latencyMs: 1 };
    }
    return { status: "ok", answers: { t0: { type: "noul", noul: 0.1 }, t1: { type: "noul", noul: 0.9 } }, model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 1, cached: false };
  } } });
  const resources = new DefaultResourceLoader({ cwd, agentDir: home, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, agentsFilesOverride: () => ({ agentsFiles: [] }), extensionFactories: [extension] });
  await resources.reload(); assert.deepEqual(resources.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: home, modelRuntime: runtime, model: runtime.getModel("fixture", "fixture"), settingsManager: settings, resourceLoader: resources, sessionManager: SessionManager.inMemory() });
  t.after(() => session.dispose()); await session.bindExtensions({});
  const running = session.prompt("Change both values and verify.");
  if (condition === "cancel") { await entering; await session.abort(); }
  await running;
  if (condition === "cancel") {
    assert.equal(calls, 1);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.execution, undefined, "Cancellation must prevent test process launch");
    assert.equal(session.messages.filter((message) => message.role === "custom" && message.customType === "pijev-checkpoint").length, 0);
    return;
  }
  assert.equal(calls, 3, "Checkpoint must not introduce a separate model turn");
  assert.equal(decisions, condition === "jev" || condition === "capped" ? 1 : 0, "Only Jev mode sends one selection for the entire batch");
  assert.equal(records.length, condition === "capped" ? 2 : 1);
  if (condition === "capped") { assert.equal(records[1]?.skipped, "checkpoint_limit"); assert.equal(records[1]?.execution, undefined); }
  if (condition === "manual") {
    assert.deepEqual(records[0]!.selected, []);
    assert.equal(records[0]!.execution, undefined);
    assert.equal(payloads.some((payload) => payload.includes("PiJev executed checkpoint")), false);
    return;
  }
  assert.deepEqual(records[0]!.selected, ["test/b.test.mjs"]);
  assert.equal(records[0]!.execution?.status, "passed");
  assert.match(payloads[1]!, /fresh edited value/);
  assert.equal((payloads[2]!.match(/PiJev executed checkpoint/g) ?? []).length, 1);
  const at = session.messages.findIndex((message) => message.role === "custom" && message.customType === "pijev-checkpoint");
  assert.ok(at > 0);
  assert.equal(session.messages[at - 1]!.role, "toolResult", "Evidence follows the entire tool batch");
});
}
