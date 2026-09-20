import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createPijevExtension } from "../src/extension.js";
import { loadConfig, type DecisionMode, type JevProvider } from "../src/config.js";
import { readRecentDecisions } from "../src/telemetry.js";
import type { Question } from "../src/jev.js";

for (const retrieval of ["literal", "question", "briefing"] as const) {
for (const provider of ["typesafe", "vercel"] satisfies JevProvider[]) {
for (const mode of ["assist", "observe", "off"] satisfies DecisionMode[]) {
  test(`real Pi runtime: ${provider}/${mode}/${retrieval} preserves tool execution and applies only permitted Jev effects`, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), "pijev-integration-"));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await writeFile(join(cwd, "a.ts"), "export const token = 'unrelated';\n");
    await writeFile(join(cwd, "b.ts"), "export function refreshToken(token: string) { return token; }\n");
    const skillPath = join(cwd, "SKILL.md");
    await writeFile(skillPath, "---\nname: tokens\ndescription: Inspect token refresh code\n---\nInspect refreshToken and validate expired tokens.\n");
    let llmCalls = 0;
    const modelRequests: string[] = [];
    let jevCalls = 0;
    const http = createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += String(chunk);
      if (req.url === "/v1/systemone" || req.url === "/v1/evaluation-model") {
        jevCalls++;
        const request = JSON.parse(text) as { questions: Record<string, Question>; state: { candidates?: Record<string, { path?: string }> } };
        const answers = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => {
          if (q.type === "noul" || String(q.type) === "boolean") {
            const score = id.startsWith("c") ? request.state.candidates?.[id]?.path === "b.ts" ? 0.95 : 0.1 : 0.95;
            return [id, provider === "vercel" ? { type: "boolean", probability: score } : { type: "noul", noul: score }];
          }
          const choice = id === "category" ? "environment" : Object.keys(q.criteria)[0]!;
          return [id, { type: "choice", choice, probabilities: Object.fromEntries(Object.keys(q.criteria).map((key) => [key, key === choice ? 1 : 0])), confidence: 0.9 }];
        }));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(provider === "vercel"
          ? { answers, usage: { inputTokens: 100, outputTokens: 0 }, providerMetadata: { typesafe: { confidence: { selection: 0.9, category: 0.9 } } } }
          : { model: "jev-fixture", answers, usage: { input_tokens: 100, output_tokens: 0 } }));
        return;
      }
      assert.equal(req.url, "/v1/chat/completions");
      modelRequests.push(text);
      llmCalls++;
      const calls = [
        { name: "pijev_search", arguments: { query: "Find token refresh implementation", ...(retrieval === "literal" ? { patterns: ["token"] } : {}) } },
        { name: "bash", arguments: { command: "exit 2" } },
        { name: "write", arguments: { path: "proof.txt", content: "PiJev tool execution verified\n" } },
      ];
      const call = calls[llmCalls - 1];
      const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${llmCalls}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } : { role: "assistant", content: "Fixture task complete." };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ id: `completion_${llmCalls}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: `completion_${llmCalls}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    t.after(() => { http.closeAllConnections(); http.close(); });
    const address = http.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const home = join(cwd, "home");
    const config = loadConfig({ PIJEV_HOME: home, PIJEV_MODE: mode, PIJEV_SOURCE_BRIEFING: retrieval === "briefing" ? "1" : "0", PIJEV_JEV_PROVIDER: provider, TYPESAFE_API_KEY: "fixture-key", AI_GATEWAY_API_KEY: "fixture-key", PIJEV_JEV_ENDPOINT: provider === "vercel" ? baseUrl : `${baseUrl}/systemone` });
    const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
    runtime.registerProvider("pijev-fixture", {
      baseUrl, api: "openai-completions", apiKey: "fixture-key",
      models: [{ id: "fixture", name: "Local test fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
    });
    const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
    const resources = new DefaultResourceLoader({
      cwd, agentDir: home, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      skillsOverride: () => ({ skills: [{ name: "tokens", description: "Inspect token refresh code", filePath: skillPath, baseDir: cwd, sourceInfo: { path: skillPath, source: "fixture", scope: "temporary", origin: "top-level" }, disableModelInvocation: false }], diagnostics: [] }),
      extensionFactories: [createPijevExtension(config)],
    });
    await resources.reload();
    assert.deepEqual(resources.getExtensions().errors, []);
    const { session } = await createAgentSession({ cwd, agentDir: home, model: runtime.getModel("pijev-fixture", "fixture"), modelRuntime: runtime, resourceLoader: resources, settingsManager: settings, sessionManager: SessionManager.inMemory() });
    t.after(() => session.dispose());
    await session.bindExtensions({});
    await session.prompt("Inspect token refresh code, then write proof.txt.");
    assert.equal(await readFile(join(cwd, "proof.txt"), "utf8"), "PiJev tool execution verified\n");
    assert.equal(llmCalls, 4);
    assert.equal(modelRequests[0]!.includes("PiJev initial evidence"), retrieval === "briefing");
    if (retrieval === "briefing") {
      assert.ok(modelRequests[0]!.includes("refreshToken"));
      assert.equal(modelRequests[0]!.includes("ranked by a judgement model"), mode === "assist");
      const conversation = JSON.parse(modelRequests[3]!).messages as { role: string; content: unknown }[];
      const snapshotIndex = conversation.findIndex((message) => JSON.stringify(message.content).includes("PiJev initial evidence"));
      assert.ok(snapshotIndex > 0 && snapshotIndex < conversation.findIndex((message) => message.role === "assistant"), "initial evidence must precede subsequent tool observations, not arrive as a fresh user message after every tool");
    }
    const search = session.messages.find((m) => m.role === "toolResult" && m.toolName === "pijev_search");
    const searchText = JSON.stringify(search);
    assert.ok(searchText.includes("a.ts") && searchText.includes("b.ts"));
    if (retrieval === "literal") assert.ok(mode === "assist" ? searchText.indexOf("b.ts") < searchText.indexOf("a.ts") : searchText.indexOf("a.ts") < searchText.indexOf("b.ts"));
    else {
      assert.equal(search?.role === "toolResult" && search.isError, false);
      assert.ok(searchText.includes("source discovery"));
      assert.equal(searchText.includes("Jev ranked"), mode === "assist");
    }
    const failure = session.messages.find((m) => m.role === "toolResult" && m.toolName === "bash");
    assert.ok(failure && failure.role === "toolResult" && failure.isError);
    assert.equal(JSON.stringify(failure).includes("PiJev diagnostic suggestion"), mode === "assist");
    const transcript = modelRequests.join("\n");
    assert.equal(transcript.includes("PiJev skill suggestion"), mode === "assist");
    const records = await readRecentDecisions(home);
    const userEntry = session.sessionManager.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "user");
    assert.ok(userEntry);
    for (const row of records) {
      assert.equal(row.sessionId, session.sessionId);
      assert.equal(row.userMessageId, userEntry.id);
    }
    if (mode === "off") { assert.equal(jevCalls, 0); assert.equal(records.length, 0); }
    else { assert.equal(jevCalls, retrieval === "briefing" ? 5 : 4); assert.equal(records.length, jevCalls); }
    if (retrieval === "briefing") {
      await writeFile(join(cwd, "b.ts"), "export const changedSnapshot = true;\n");
      await session.prompt("Inspect the changed snapshot for this next task.");
      assert.ok(modelRequests.at(-1)!.includes("changedSnapshot"));
      const latest = await readRecentDecisions(home);
      assert.equal(latest.filter((row) => row.kind === "source_briefing").length, mode === "off" ? 0 : 2);
      if (mode !== "off") assert.notEqual(latest.at(-1)!.userMessageId, userEntry.id);
      const previousSession = session.sessionId;
      const { session: switchedSession } = await createAgentSession({ cwd, agentDir: home, model: runtime.getModel("pijev-fixture", "fixture"), modelRuntime: runtime, resourceLoader: resources, settingsManager: settings, sessionManager: SessionManager.inMemory() });
      t.after(() => switchedSession.dispose());
      await switchedSession.bindExtensions({});
      assert.notEqual(switchedSession.sessionId, previousSession);
      await switchedSession.prompt("Inspect token refresh in this new session.");
      const switched = await readRecentDecisions(home);
      if (mode !== "off") {
        assert.equal(switched.at(-1)!.sessionId, switchedSession.sessionId);
        assert.notEqual(switched.at(-1)!.userMessageId, latest.at(-1)!.userMessageId);
      }
    }
  });
}
}
}
