import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createPijevExtension } from "../src/extension.js";
import { loadConfig } from "../src/config.js";

// Exercise actual Pi cancellation, not an extension-only AbortController.
test("session.abort cancels an in-flight skill decision before any coding-model request", { timeout: 10000 }, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pijev-cancel-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const skillPath = join(cwd, "SKILL.md");
  await writeFile(skillPath, "Inspect tokens before changing code.");
  let jevCalls = 0;
  let modelCalls = 0;
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  const http = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain request. */ }
    if (req.url === "/v1/systemone") {
      jevCalls++;
      entered();
      await held;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "jev", answers: { needed: { type: "noul", noul: 1 }, selection: { type: "choice", choice: "s0", probabilities: { s0: 1 }, confidence: 1 }, s0: { type: "noul", noul: 1 } }, usage: { input_tokens: 1, output_tokens: 0 } }));
    } else { modelCalls++; res.writeHead(500); res.end("Unexpected model request after cancellation"); }
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => { http.closeAllConnections(); http.close(); });
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const home = join(cwd, "home");
  const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("pijev-fixture", { baseUrl, api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 512 }] });
  const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const resources = new DefaultResourceLoader({
    cwd, agentDir: home, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    skillsOverride: () => ({ skills: [{ name: "tokens", description: "Inspect tokens", filePath: skillPath, baseDir: cwd, sourceInfo: { path: skillPath, source: "fixture", scope: "temporary", origin: "top-level" }, disableModelInvocation: false }], diagnostics: [] }),
    extensionFactories: [createPijevExtension(loadConfig({ PIJEV_HOME: home, TYPESAFE_API_KEY: "fixture", PIJEV_JEV_ENDPOINT: `${baseUrl}/systemone`, PIJEV_JEV_TIMEOUT_MS: "5000" }))],
  });
  await resources.reload();
  const { session } = await createAgentSession({ cwd, agentDir: home, modelRuntime: runtime, model: runtime.getModel("pijev-fixture", "fixture"), settingsManager: settings, resourceLoader: resources, sessionManager: SessionManager.inMemory() });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  const prompt = session.prompt("Inspect the token code.");
  await waiting;
  const start = performance.now();
  await session.abort();
  assert.ok(performance.now() - start < 1000, "abort must cancel the request without waiting for its deadline");
  release();
  await prompt;
  assert.equal(jevCalls, 1);
  assert.equal(modelCalls, 0);
  assert.equal(session.isIdle, true);
});
