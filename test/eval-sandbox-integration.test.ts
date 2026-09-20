import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { shellEnvironment, shellQuote } from "../eval/sandbox.js";

async function loadedControlFixture(t: test.TestContext, protectedHome: "valid" | "missing" | "workspace", launchCli = false, checkpoint: boolean | "no-ack" = false, placement: boolean | "no-ack" | "jev" = false) {
  const root = await realpath(await mkdtemp("/private/tmp/pijev-iso-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "clone");
  const protectedRoot = join(root, "actual-home");
  await Promise.all([mkdir(cwd), mkdir(protectedRoot)]);
  await Promise.all([mkdir(join(cwd, ".home")), mkdir(join(cwd, ".tmp"))]);
  const localDocs = join(cwd, "node_modules", "@earendil-works", "pi-coding-agent", "docs");
  await mkdir(localDocs, { recursive: true });
  await writeFile(join(localDocs, "extensions.md"), "LOCAL_SDK_DOCUMENTATION\n");
  await writeFile(join(protectedRoot, "marker.txt"), "NON_SECRET_ISOLATION_MARKER\n");
  await writeFile(join(root, "peer-candidate.txt"), "SYNTHETIC_PEER_CANDIDATE\n");
  const env: NodeJS.ProcessEnv = { HOME: join(cwd, ".home"), PIJEV_EVAL_WORKSPACE: cwd, PIJEV_EVAL_STATS: join(root, "stats.json"), PIJEV_EVAL_TURNS: "12", PIJEV_EVAL_TOKENS: "100000", PIJEV_ISOLATION_SENTINEL: "synthetic-inherited-marker", PIJEV_EVAL_PROTECTED_HOME: protectedHome === "valid" ? protectedRoot : protectedHome === "workspace" ? join(cwd, ".home") : undefined };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const commands = [
    `cat ${shellQuote(join(protectedRoot, "marker.txt"))}`,
    `printf forbidden > ${shellQuote(join(root, "outside.txt"))}`,
    'printf "%s" "${PIJEV_ISOLATION_SENTINEL-unset}" > environment.txt',
    `cat ${shellQuote(resolve("package.json"))} > /dev/null`,
    "printf permitted > proof.txt",
    `cat ${shellQuote(join(root, "peer-candidate.txt"))}`,
  ];
  if (checkpoint) {
    await Promise.all([mkdir(join(cwd, "src")), mkdir(join(cwd, "test"))]);
    await writeFile(join(cwd, "src/example.mjs"), "export const value = 1;\n");
    await writeFile(join(cwd, "test/example.test.mjs"), "import assert from 'node:assert/strict'; import { value } from '../src/example.mjs'; assert.equal(value, 2);\n");
    commands.push("printf 'export const value = 2;\\n' > src/example.mjs");
  }
  if (placement) {
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "test"), { recursive: true });
    await writeFile(join(cwd, "TASK.md"), "Persist the Jev mode with real production regression tests.");
  }
  let requests = 0;
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    if (req.url === "/jev") {
      const request = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "jev-fixture", answers: Object.fromEntries(Object.keys(request.questions).map(id => [id, { type: "noul", noul: 0.1 }])), usage: { input_tokens: 1, output_tokens: 1 } }));
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: { role: string; content: string }[] };
    const system = body.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const docs = system.match(/^- Additional docs: (.+)$/m)?.[1];
    // Follow the documentation path actually advertised to the coding model.
    const command = commands[requests] ?? (requests === commands.length && docs ? `cat ${shellQuote(join(docs, "extensions.md"))}` : undefined);
    requests++;
    const delta = command ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${requests}`, type: "function", function: { name: "bash", arguments: JSON.stringify({ command }) } }] } : { role: "assistant", content: "Fixture complete." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: `r${requests}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: `r${requests}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: command ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => { http.closeAllConnections(); http.close(); });
  const address = http.address();
  assert.ok(address && typeof address === "object");
  const home = join(root, "agent");
  if (launchCli) {
    await mkdir(home);
    await writeFile(join(home, "models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "fixture-only", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 }] } } }));
    let checkpointReady = false, placementReady = false;
    const checkpointProcesses: string[] = [];
    const child = spawn(process.execPath, [resolve("bin/pijev.mjs"), "--jev-mode", "off", "--mode", "json", "--print", "--provider", "fixture", "--model", "fixture", "--thinking", "off", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-extensions", "--offline", "--extension", resolve("eval/cli-control.ts"), ...(checkpoint ? ["--extension", resolve("eval/checkpoint-extension.ts")] : []), ...(placement ? ["--extension", resolve("eval/placement-extension.ts")] : []), "Run the isolation fixture commands."], {
      cwd, env: { ...shellEnvironment(cwd), ...env, PIJEV_HOME: home, PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1", ...(checkpoint ? { PIJEV_CHECKPOINT_MODE: "dependencies", PIJEV_CHECKPOINT_LOG: join(root, "checkpoints.jsonl") } : {}), ...(placement ? { PIJEV_PLACEMENT_POLICY: placement === "jev" ? "finish-jev" : "finish-local", PIJEV_JEV_PROVIDER: "typesafe", TYPESAFE_API_KEY: "local-fixture-only", PIJEV_JEV_ENDPOINT: `http://127.0.0.1:${address.port}/jev`, PIJEV_PLACEMENT_TASK: "session-mode", PIJEV_PLACEMENT_LOG: join(root, "placements.jsonl") } : {}) }, timeout: 10000, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.on("message", (message) => {
      const event = message as { type?: string; phase?: string };
      if (event.type === "pijev_checkpoint_ready") { checkpointReady = true; if (checkpoint !== "no-ack") child.send({ type: "pijev_checkpoint_ack" }); }
      if (event.type === "pijev_placement_ready") { placementReady = true; if (placement !== "no-ack") child.send({ type: "pijev_placement_ack" }); }
      if (event.type === "pijev_checkpoint_process") checkpointProcesses.push(event.phase!);
    });
    const result = { stdout: "", stderr: "" };
    child.stdout!.on("data", (data: Buffer) => { result.stdout += data.toString(); });
    child.stderr!.on("data", (data: Buffer) => { result.stderr += data.toString(); });
    const [exitCode] = await once(child, "close");
    if (checkpoint !== "no-ack" && placement !== "no-ack") assert.equal(exitCode, 0, result.stderr);
    const events = result.stdout.split("\n").flatMap((line) => { try { return [JSON.parse(line) as { type?: string; message?: { role?: string; isError?: boolean } }]; } catch { return []; } });
    return { root, cwd, requests, checkpointReady, placementReady, checkpointProcesses, stderr: result.stderr, results: events.filter((event) => event.type === "message_end" && event.message?.role === "toolResult").map((event) => event.message!) };
  }
  const runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("fixture", { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "fixture-only", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 }] });
  const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
  const resources = new DefaultResourceLoader({ cwd, agentDir: home, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [resolve("eval/cli-control.ts")] });
  await resources.reload();
  assert.deepEqual(resources.getExtensions().errors, [], "the control must stay loaded even when denying a bad configuration");
  const { session } = await createAgentSession({ cwd, agentDir: home, modelRuntime: runtime, model: runtime.getModel("fixture", "fixture"), settingsManager: settings, resourceLoader: resources, sessionManager: SessionManager.inMemory() });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  await session.prompt("Run the isolation fixture commands.");
  return { root, cwd, requests, results: session.messages.filter((message) => message.role === "toolResult") };
}

test("loaded CLI control protects the real home and development repository despite rewritten HOME", { skip: process.platform !== "darwin", timeout: 10000 }, async (t) => {
  const result = await loadedControlFixture(t, "valid");
  assert.equal(result.requests, 8);
  assert.equal(result.results[0]?.isError, true, "protected marker read must fail");
  assert.equal(result.results[1]?.isError, true, "outside write must fail");
  await assert.rejects(access(join(result.root, "outside.txt")));
  assert.equal(await readFile(join(result.cwd, "environment.txt"), "utf8"), "unset");
  assert.equal(result.results[3]?.isError, true, "development repository read must fail");
  assert.equal(await readFile(join(result.cwd, "proof.txt"), "utf8"), "permitted");
  assert.ok(!JSON.stringify(result.results).includes("NON_SECRET_ISOLATION_MARKER"));
  assert.equal(result.results[5]?.isError, true, "peer candidate read must fail");
  assert.ok(!JSON.stringify(result.results).includes("SYNTHETIC_PEER_CANDIDATE"));
  assert.equal(result.results[6]?.isError, false, "advertised SDK documentation must be readable within the task clone");
  assert.ok(JSON.stringify(result.results[6]).includes("LOCAL_SDK_DOCUMENTATION"));
});

test("actual CLI startup retains protected roots when launched in a separate task checkout", { skip: process.platform !== "darwin", timeout: 15000 }, async (t) => {
  const result = await loadedControlFixture(t, "valid", true);
  assert.equal(result.requests, 8);
  assert.equal(result.results[0]?.isError, true);
  assert.equal(result.results[1]?.isError, true);
  assert.equal(result.results[3]?.isError, true);
  await assert.rejects(access(join(result.root, "outside.txt")));
  assert.equal(await readFile(join(result.cwd, "environment.txt"), "utf8"), "unset");
  assert.equal(await readFile(join(result.cwd, "proof.txt"), "utf8"), "permitted");
  assert.equal(result.results[5]?.isError, true, "the real CLI must deny other candidate trees");
  assert.ok(!JSON.stringify(result.results).includes("SYNTHETIC_PEER_CANDIDATE"));
  assert.equal(result.results[6]?.isError, false, "the real CLI must advertise the clone's installed SDK docs");
  assert.ok(JSON.stringify(result.results[6]).includes("LOCAL_SDK_DOCUMENTATION"));
});

test("actual CLI loads the checkpoint extension without weakening isolation", { skip: process.platform !== "darwin", timeout: 15000 }, async (t) => {
  const result = await loadedControlFixture(t, "valid", true, true);
  assert.equal(result.checkpointReady, true, result.stderr);
  assert.deepEqual(result.checkpointProcesses, ["start", "stop"]);
  assert.equal(result.requests, 9);
  assert.equal(result.results[0]?.isError, true);
  assert.equal(result.results[3]?.isError, true);
  assert.equal(result.results[5]?.isError, true);
  assert.equal(await readFile(join(result.cwd, "proof.txt"), "utf8"), "permitted");
});

for (const invalid of ["missing", "workspace"] as const) {
  test(`loaded CLI control fails closed for ${invalid} protected-home configuration`, { skip: process.platform !== "darwin", timeout: 10000 }, async (t) => {
    const result = await loadedControlFixture(t, invalid);
    assert.equal(result.requests, 0, "misconfigured isolation must stop before any provider or tool execution");
    assert.equal(result.results.length, 0);
  });
}

test("actual CLI sends no model request when checkpoint readiness is not acknowledged", { skip: process.platform !== "darwin", timeout: 15000 }, async (t) => {
  const result = await loadedControlFixture(t, "valid", true, "no-ack");
  assert.equal(result.checkpointReady, true);
  assert.equal(result.requests, 0);
  assert.deepEqual(result.checkpointProcesses, []);
});

for (const placement of [true, "jev", "no-ack"] as const) {
  test(`actual CLI placement ${placement !== "no-ack" ? `continues once before returning (${placement === "jev" ? "Jev transport" : "local checklist"})` : "blocks requests without readiness acknowledgement"}`, { skip: process.platform !== "darwin", timeout: 15000 }, async (t) => {
    const result = await loadedControlFixture(t, "valid", true, false, placement);
    assert.equal(result.placementReady, true, result.stderr);
    assert.equal(result.requests, placement !== "no-ack" ? 9 : 0);
    if (placement !== "no-ack") {
      const records = (await readFile(join(result.root, "placements.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.equal(records.length, 2);
      assert.deepEqual(records.map(record => record.continued), [true, false]);
      assert.ok(records.every(record => record.kind === "finish"));
      if (placement === "jev") assert.ok(records.every(record => record.decision.status === "ok" && record.decision.model === "jev-fixture"));
    }
  });
}
