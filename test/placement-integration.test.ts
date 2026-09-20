import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createPlacementExtension, type PlacementRecord } from "../eval/placement-extension.js";
import type { Placement } from "../eval/placement.js";
for (const scenario of [...(["baseline", "output-local", "output-jev", "finish-local", "finish-jev"] as Placement[]).map(policy => ({ policy, bashRead: false, deletion: false })), { policy: "output-jev" as Placement, bashRead: true, deletion: false }, { policy: "finish-jev" as Placement, bashRead: false, deletion: true }]) {
    const { policy, bashRead, deletion } = scenario;
    test(`actual Pi placement ${policy} changes only its assigned boundary (bash=${bashRead}, deletion=${deletion})`, { timeout: 12000 }, async (t) => {
        const cwd = await mkdtemp(join(tmpdir(), "pijev-placement-test-"));
        t.after(() => rm(cwd, { recursive: true, force: true }));
        await mkdir(join(cwd, "src"));
        await mkdir(join(cwd, "test"));
        const original = Array.from({ length: 48 }, (_, i) => `// line ${i + 1} ${i === 12 ? "MID_SENTINEL" : "irrelevant detail"}`).join("\n");
        await writeFile(join(cwd, "src/a.mjs"), original);
        await writeFile(join(cwd, "test/read.test.txt"), original);
        let calls = 0, decisions = 0;
        const states: unknown[] = [];
        const payloads: string[] = [];
        const records: PlacementRecord[] = [];
        const server = createServer(async (req, res) => {
            let body = "";
            for await (const chunk of req)
                body += String(chunk);
            payloads.push(body);
            calls++;
            const tool = calls === 1 ? { index: 0, id: "read_source", type: "function", function: { name: bashRead || deletion ? "bash" : "read", arguments: JSON.stringify(deletion ? { command: "rm src/a.mjs" } : bashRead ? { command: "cat test/read.test.txt" } : { path: "src/a.mjs" }) } } : undefined;
            const delta = tool ? { role: "assistant", tool_calls: [tool] } : { role: "assistant", content: "Complete." };
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            for (const [part, finish] of [[delta, null], [{}, tool ? "tool_calls" : "stop"]])
                res.write(`data: ${JSON.stringify({ id: `m${calls}`, object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`);
            res.end("data: [DONE]\n\n");
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        t.after(() => { server.closeAllConnections(); server.close(); });
        const address = server.address();
        assert.ok(address && typeof address === "object");
        const home = join(cwd, ".home"), runtime = await ModelRuntime.create({ authPath: join(home, "auth.json"), modelsPath: null, refreshOnCreate: false });
        runtime.registerProvider("fixture", { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "fixture", models: [{ id: "fixture", name: "fixture", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
        const settings = SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } });
        const extension = createPlacementExtension({ policy, cwd, task: "Repair and add tests", requirements: ["tests exercise production"], onRecord: async (r) => { records.push(r); }, provider: { evaluate: async (_state, questions) => { decisions++; states.push(_state); return { status: "ok", model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 1, cached: false, answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: "noul", noul: id === "c1" ? 0.9 : 0.1 }])) }; } } });
        const resources = new DefaultResourceLoader({ cwd, agentDir: home, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, agentsFilesOverride: () => ({ agentsFiles: [] }), extensionFactories: [extension] });
        await resources.reload();
        assert.deepEqual(resources.getExtensions().errors, []);
        const { session } = await createAgentSession({ cwd, agentDir: home, modelRuntime: runtime, model: runtime.getModel("fixture", "fixture"), settingsManager: settings, resourceLoader: resources, sessionManager: SessionManager.inMemory() });
        t.after(() => session.dispose());
        await session.bindExtensions({});
        await session.prompt("Repair and add tests");
        if (deletion) {
            assert.ok(states.every(state => JSON.stringify(state).includes("\"deletedPaths\":[\"src/a.mjs\"]")));
            assert.ok(records.every(record => JSON.stringify(record.deletedPaths) === '["src/a.mjs"]'));
        }
        assert.equal(calls, policy.startsWith("finish") ? 3 : 2, "finish must continue once before prompt resolves");
        assert.equal(decisions, policy === "finish-jev" ? 2 : policy === "output-jev" ? 1 : 0);
        assert.equal(payloads[1]!.includes("Experimental output filter"), policy.startsWith("output"));
        if (policy === "output-local")
            assert.ok(!payloads[1]!.includes("MID_SENTINEL"));
        if (policy === "output-jev")
            assert.ok(payloads[1]!.includes("MID_SENTINEL"));
        if (policy.startsWith("finish")) {
            assert.ok(payloads[2]!.includes("tests exercise production"));
            assert.equal(records.filter(r => r.continued).length, 1);
        }
    });
}
