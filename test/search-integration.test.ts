import assert from "node:assert/strict";
import { once } from "node:events";
import { watch } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { loadConfig, type DecisionMode, type JevProvider } from "../src/config.js";
import { createPijevExtension } from "../src/extension.js";
import { readRecentDecisions } from "../src/telemetry.js";

const query = "Which component refreshes the session token?";
const sourceFiles = {
  "refresh.ts": "export function refreshSessionToken() { return 'refreshed'; }\n",
  "storage.ts": "export function readStoredToken() { return 'stored'; }\n",
  "request.ts": "export function sendRequest() { return 'sent'; }\n",
  "queue.ts": "export function cancelQueuedRequest() { return 'cancelled'; }\n",
  "options.ts": "export const defaultOptions = { retries: 2 };\n",
};

type RankState = { query: string; candidates: Record<string, { path: string; excerpt: string }> };

async function searchSession(t: test.TestContext, mode: DecisionMode, provider: JevProvider, outcome: "success" | "failure" | "held" = "success") {
  const root = await mkdtemp(join(tmpdir(), "pijev-search-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const home = join(root, "agent"); // Decision journals must not enter the source candidate set.
  await mkdir(cwd);
  await Promise.all(Object.entries(sourceFiles).map(([path, source]) => writeFile(join(cwd, path), source)));
  const requests: RankState[] = [];
  let modelCalls = 0;
  let entered!: () => void;
  const rankEntered = new Promise<void>((resolve) => { entered = resolve; });
  let closed!: () => void;
  const rankClosed = new Promise<void>((resolve) => { closed = resolve; });
  const http = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    if (req.url === "/v1/systemone" || req.url === "/v1/evaluation-model") {
      const request = JSON.parse(body) as { state: RankState; questions: Record<string, unknown> };
      requests.push(request.state);
      res.once("close", closed);
      entered();
      if (outcome === "held") return;
      if (outcome === "failure") { res.writeHead(503); res.end("Fixture service unavailable"); return; }
      // Deliberately reverse discovery order, so applying observe scores is observable.
      const ids = Object.keys(request.questions);
      const answers = Object.fromEntries(ids.map((id, index) => [id, provider === "vercel"
        ? { type: "boolean", probability: (index + 1) / (ids.length + 1) }
        : { type: "noul", noul: (index + 1) / (ids.length + 1) }]));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(provider === "vercel"
        ? { answers, usage: { inputTokens: 100, outputTokens: 0 } }
        : { model: "jev-fixture", answers, usage: { input_tokens: 100, output_tokens: 0 } }));
      return;
    }
    modelCalls++;
    const call = modelCalls === 1 ? { name: "pijev_search", arguments: { query, limit: 20 } } : undefined;
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: "source_search", type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Search complete." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [chunk, finish] of [[delta, null], [{}, call ? "tool_calls" : "stop"]]) {
      res.write(`data: ${JSON.stringify({ id: `completion_${modelCalls}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: chunk, finish_reason: finish }] })}\n\n`);
    }
    res.end("data: [DONE]\n\n");
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => { http.closeAllConnections(); http.close(); });
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const config = loadConfig({ PIJEV_HOME: home, PIJEV_MODE: mode, PIJEV_SOURCE_BRIEFING: "0", PIJEV_JEV_PROVIDER: provider, TYPESAFE_API_KEY: "fixture", AI_GATEWAY_API_KEY: "fixture", PIJEV_JEV_ENDPOINT: provider === "vercel" ? baseUrl : `${baseUrl}/systemone`, PIJEV_JEV_TIMEOUT_MS: "5000" });
  const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("pijev-fixture", { baseUrl, api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 512 }] });
  const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const resources = new DefaultResourceLoader({
    cwd, agentDir: home, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }), skillsOverride: () => ({ skills: [], diagnostics: [] }),
    extensionFactories: [createPijevExtension(config)],
  });
  await resources.reload();
  assert.deepEqual(resources.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd, agentDir: home, modelRuntime: runtime, model: runtime.getModel("pijev-fixture", "fixture"), settingsManager: settings, resourceLoader: resources, sessionManager: SessionManager.inMemory() });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  function searchResult() {
    const result = session.messages.find((message) => message.role === "toolResult" && message.toolName === "pijev_search");
    assert.ok(result?.role === "toolResult");
    assert.equal(result.isError, false);
    const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    // Compare the actual paths, numbered lines and source delivered to Pi.
    const blocks = text.split("\n\n").slice(1).map((block) => block.replace(/ · relevance [\d.]+(?=\n)/, ""));
    assert.equal(blocks.length, Object.keys(sourceFiles).length);
    for (const [path, source] of Object.entries(sourceFiles)) {
      assert.ok(blocks.includes(`${path}:1\n1: ${source.trimEnd()}\n2: `), `Missing exact source evidence for ${path}`);
    }
    return { text, blocks, details: result.details };
  }
  return { root, home, session, requests, rankEntered, rankClosed, searchResult, modelCalls: () => modelCalls };
}

for (const provider of ["typesafe", "vercel"] satisfies JevProvider[]) {
  test(`real Pi ${provider}: observe preserves exact natural-question evidence and assist only reorders it`, async (t) => {
    const off = await searchSession(t, "off", provider);
    const observe = await searchSession(t, "observe", provider);
    const assist = await searchSession(t, "assist", provider);
    for (const fixture of [off, observe, assist]) await fixture.session.prompt(query);
    const baseline = off.searchResult();
    assert.deepEqual(observe.searchResult(), baseline);
    assert.deepEqual(assist.searchResult().blocks, [...baseline.blocks].reverse());
    assert.match(assist.searchResult().text, /Jev ranked/);
    assert.equal(off.requests.length, 0);
    assert.equal(observe.requests.length, 1);
    assert.equal(assist.requests.length, 1);
    assert.deepEqual(observe.requests, assist.requests);
    assert.deepEqual(Object.values(observe.requests[0]!.candidates).map((candidate) => candidate.path).sort(), Object.keys(sourceFiles).sort());
  });

  test(`real Pi ${provider}: failed Jev ranking returns the exact deterministic discovery fallback`, async (t) => {
    const off = await searchSession(t, "off", provider);
    const failed = await searchSession(t, "assist", provider, "failure");
    await off.session.prompt(query);
    await failed.session.prompt(query);
    assert.deepEqual(failed.searchResult(), off.searchResult());
    assert.equal(failed.requests.length, 2, "A ranking the gateway refuses with a 5xx is retried exactly once");
    assert.equal(failed.modelCalls(), 2, "Pi must continue with the returned source evidence");
    const records = await readRecentDecisions(failed.home);
    assert.equal(records.length, 2, "both attempts are journaled");
    for (const record of records) {
      assert.equal(record.kind, "code_rank");
      assert.equal(record.status, "fallback");
      assert.equal(record.reason, "http_503");
    }
  });
}

test("session.abort cancels pijev_search while Jev ranking is in flight", { timeout: 10000 }, async (t) => {
  const fixture = await searchSession(t, "assist", "typesafe", "held");
  const prompt = fixture.session.prompt(query);
  await fixture.rankEntered;
  const started = performance.now();
  await fixture.session.abort();
  assert.ok(performance.now() - started < 1000, "Abort must propagate without waiting for the Jev deadline");
  await prompt;
  await fixture.rankClosed;
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.modelCalls(), 1, "Cancellation must not feed a fallback into another model turn");
  assert.equal(fixture.session.isIdle, true);
});

test("session.abort cancels pijev_search during source enumeration and terminates rg", { timeout: 10000 }, async (t) => {
  const fixture = await searchSession(t, "off", "typesafe");
  const bin = join(fixture.root, "bin");
  await mkdir(bin);
  const marker = join(bin, "started");
  const executable = join(bin, "rg");
  // Replace only the external executable to keep actual Pi tool cancellation intact.
  await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  await chmod(executable, 0o755);
  const watcher = watch(bin);
  t.after(() => watcher.close());
  const entered = new Promise<void>((resolve) => { watcher.on("change", (_event, file) => { if (file === "started") resolve(); }); });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath ?? ""}`;
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  const prompt = fixture.session.prompt(query);
  await entered;
  const pid = Number(await readFile(marker, "utf8"));
  const started = performance.now();
  await fixture.session.abort();
  assert.ok(performance.now() - started < 1000, "Abort must terminate enumeration without waiting for its deadline");
  await prompt;
  assert.throws(() => process.kill(pid, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.modelCalls(), 1);
  assert.equal(fixture.session.isIdle, true);
});
