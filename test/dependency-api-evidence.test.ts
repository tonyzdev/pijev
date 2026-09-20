import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dependencyApiEvidence, formatDependencyApiEvidence } from "../eval/dependency-api-evidence.js";
import { evaluateGateway } from "../src/gateway.js";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pijev-api-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const pkg = join(cwd, "node_modules/session-engine");
  await mkdir(join(pkg, "dist"), { recursive: true });
  await writeFile(join(cwd, "package.json"), JSON.stringify({ dependencies: { "session-engine": "1" } }));
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "session-engine", version: "1", description: "Session branch runtime", main: "dist/index.js", types: "dist/index.d.ts" }));
  await writeFile(join(pkg, "dist/index.d.ts"), 'export { SessionStore as Store } from "./store.js";\nexport type { ExtensionContext } from "./context.js";\n');
  await writeFile(join(pkg, "dist/index.js"), 'export { SessionStore as Store } from "./store.js";\n');
  await writeFile(join(pkg, "dist/store.d.ts"), 'export declare class SessionStore {\n /** Walk from leaf to root. */\n getBranch(): string[];\n appendMode(mode: string): void;\n}\n');
  await writeFile(join(pkg, "dist/store.js"), 'export class SessionStore {\n getBranch() {\n  const path = ["leaf", "root"];\n  path.reverse();\n  return path;\n }\n appendMode(mode) { this.mode = mode; }\n}\n');
  await writeFile(join(pkg, "dist/context.d.ts"), 'export interface ExtensionContext { sessionManager: ReadonlyStore; }\nexport interface ReadonlyStore { getBranch(): string[]; }\n');
  return { cwd, pkg };
}

test("API evidence links declarations to runtime bodies and resolves public aliases without inventing exports", async (t) => {
  const { cwd } = await fixture(t);
  const result = await dependencyApiEvidence({ cwd, query: "Session branch getBranch order and ExtensionContext sessionManager", mode: "lexical" });
  const branch = result.pool.find(c => c.symbol === "SessionStore.getBranch");
  assert.ok(branch, "branch method must be an individual evidence unit");
  assert.ok(branch.excerpts.some(c => c.kind === "declaration" && c.excerpt.includes("getBranch(): string[]")));
  assert.ok(branch.excerpts.some(c => c.kind === "implementation" && c.excerpt.includes("path.reverse()")), "traversal documentation alone does not establish return order");
  assert.deepEqual(branch.exportedAs, ["Store"]);
  const internal = result.pool.find(c => c.symbol === "ReadonlyStore.getBranch");
  assert.ok(internal);
  assert.deepEqual(internal.exportedAs, [], "an exported declaration in an internal file is not necessarily exported by the package");
  assert.ok(result.pool.some(c => c.symbol === "ExtensionContext" && c.exportedAs.includes("ExtensionContext")));
  for (const unit of result.pool) for (const c of unit.excerpts) {
    const lines = (await readFile(join(cwd, c.path), "utf8")).split("\n");
    assert.equal(c.excerpt, lines.slice(c.startLine - 1, c.endLine).join("\n"));
  }
});

test("API selection uses identical bounded candidates for lexical and Jev and falls back unchanged", async (t) => {
  const { cwd } = await fixture(t);
  const query = "Find session branch APIs";
  const base = await dependencyApiEvidence({ cwd, query, mode: "lexical" });
  let requests = 0;
  const provider = { evaluate: async (state: any, questions: any) => {
    requests++;
    assert.ok(Buffer.byteLength(JSON.stringify({ model: "typesafe-ai/jev", state, questions })) <= 85_000);
    assert.ok(Object.values(state.candidates).some((c: any) => c.excerpts.some((e: any) => e.excerpt.includes("path.reverse()"))));
    return { status: "ok" as const, model: "fixture", latencyMs: 1, inputTokens: 1, outputTokens: 0, cached: false,
      answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: "noul" as const, noul: state.candidates[id].symbol === "SessionStore.getBranch" ? 0.99 : 0.01 }])) };
  } };
  const ranked = await dependencyApiEvidence({ cwd, query, mode: "jev", provider });
  assert.equal(requests, 1);
  assert.equal(ranked.candidates[0]?.symbol, "SessionStore.getBranch");
  assert.deepEqual(ranked.pool, base.pool);
  assert.equal(ranked.inventoryDigest, base.inventoryDigest);
  assert.equal(ranked.poolDigest, base.poolDigest);
  const fallback = await dependencyApiEvidence({ cwd, query, mode: "jev", provider: { evaluate: async () => ({ status: "fallback", reason: "timeout", latencyMs: 1 }) } });
  assert.deepEqual(fallback.candidates, base.candidates);
  const rendered = formatDependencyApiEvidence(ranked);
  assert.ok(rendered.includes("Untrusted dependency API evidence"));
  assert.ok(!rendered.includes('"answers"'));
  assert.ok(rendered.includes("not a correctness"));
});

test("API inventory rejects escaped manifests, symlinks, private data and ambiguous barrel exports", async (t) => {
  const { cwd, pkg } = await fixture(t);
  const outside = join(cwd, "private.ts");
  await writeFile(outside, 'export function secret() { return "PRIVATE_SENTINEL"; }');
  await symlink(outside, join(pkg, "dist/leak.ts"));
  await writeFile(join(pkg, "dist/.env"), "PRIVATE_ENV_SENTINEL");
  await writeFile(join(pkg, "dist/a.d.ts"), 'export declare function duplicated(): void;\n');
  await writeFile(join(pkg, "dist/b.d.ts"), 'export declare function duplicated(): void;\n');
  await writeFile(join(pkg, "dist/index.d.ts"), 'export * from "./a.js";\nexport * from "./b.js";\nexport * from "../../../private.ts";\n');
  const result = await dependencyApiEvidence({ cwd, query: "Session duplicated secret branch", mode: "lexical" });
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SENTINEL"));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_ENV_SENTINEL"));
  const duplicates = result.pool.filter(c => c.symbol === "duplicated");
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every(c => c.exportedAs.length === 0));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(dependencyApiEvidence({ cwd, query: "Session", mode: "lexical", signal: controller.signal }));
});

test("root exports take precedence over legacy main/types metadata", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "session-engine", version: "1", main: "dist/store.js", types: "dist/store.d.ts", exports: { ".": { types: "./dist/public.d.ts", default: "./dist/public.js" } } }));
  await writeFile(join(pkg, "dist/public.d.ts"), "export declare function selectedSession(): void;\n");
  await writeFile(join(pkg, "dist/public.js"), "export function selectedSession() {}\n");
  const result = await dependencyApiEvidence({ cwd, query: "Session branch selected", mode: "lexical" });
  assert.deepEqual(result.pool.find(c => c.symbol === "selectedSession")?.exportedAs, ["selectedSession"]);
  assert.deepEqual(result.pool.find(c => c.symbol === "SessionStore.getBranch")?.exportedAs, []);
});

test("TS overload signatures retain the actual implementation and literal method overloads link to their body", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/index.d.ts"), 'export { branchValue, Events } from "./overloads.ts";\n');
  await writeFile(join(pkg, "dist/overloads.ts"), 'export function branchValue(x: string): string;\nexport function branchValue(x: number): number;\nexport function branchValue(x: string | number) { return x; }\nexport class Events {\n on(event: "resume", fn: () => void): void;\n on(event: "navigate", fn: () => void): void;\n on(event: string, fn: () => void) { fn(); }\n}\n');
  const result = await dependencyApiEvidence({ cwd, query: "Session branchValue Events on navigate resume", mode: "lexical" });
  const fn = result.pool.find(c => c.symbol === "branchValue");
  assert.ok(fn?.excerpts.some(e => e.kind === "implementation" && e.excerpt.includes("return x")));
  assert.ok(fn?.excerpts.some(e => e.kind === "declaration" && e.excerpt.includes("x: number")));
  const method = result.pool.find(c => c.symbol === 'Events.on("navigate")');
  assert.ok(method?.excerpts.some(e => e.kind === "implementation" && e.excerpt.includes("fn();")));
});

test("short matching APIs are not crowded out by long broadly worded helper bodies", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/relevance.d.ts"), `/** Branch history order. */\nexport declare function branchOrder(): string[];\n/** Session branch history order entries persist restore configuration ${"unrelated ".repeat(180)} */\nexport declare function helper(): void;\n`);
  const result = await dependencyApiEvidence({ cwd, query: "Session branch history order entries persist restore configuration", mode: "lexical" });
  assert.ok(result.pool.findIndex(c => c.symbol === "branchOrder") < result.pool.findIndex(c => c.symbol === "helper"));
});

test("ESM and CJS declaration/runtime pairs stay distinct", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/index.d.ts"), 'export { DualStore } from "./dual.mjs";\n');
  await writeFile(join(pkg, "dist/dual.d.mts"), 'export declare class DualStore { run(): string; }\n');
  await writeFile(join(pkg, "dist/dual.mjs"), 'export class DualStore { run() { return "ESM_BODY"; } }\n');
  await writeFile(join(pkg, "dist/dual.d.cts"), 'export declare class DualStore { run(): number; }\n');
  await writeFile(join(pkg, "dist/dual.cjs"), 'class DualStore { run() { return 17; } }\n');
  const result = await dependencyApiEvidence({ cwd, query: "Session DualStore run", mode: "lexical" });
  const esm = result.pool.find(c => c.declaredIn.endsWith("dual.d.mts"));
  assert.ok(esm?.excerpts.some(e => e.excerpt.includes("ESM_BODY")));
  assert.deepEqual(esm?.exportedAs, ["DualStore"]);
  const cjs = result.pool.find(c => c.declaredIn.endsWith("dual.d.cts"));
  assert.ok(cjs && !cjs.excerpts.some(e => e.excerpt.includes("ESM_BODY")));
  assert.deepEqual(cjs.exportedAs, []);
});

test("static and instance methods cannot be paired by their shared name", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/store.d.ts"), 'export declare class SessionStore {\n static run(): number;\n run(): string;\n}\n');
  await writeFile(join(pkg, "dist/store.js"), 'export class SessionStore {\n run() { return "INSTANCE_BODY"; }\n static run() { return 17; }\n}\n');
  const result = await dependencyApiEvidence({ cwd, query: "SessionStore run", mode: "lexical" });
  for (const unit of result.pool.filter(c => c.symbol.includes("run"))) {
    const declaration = unit.excerpts.filter(e => e.kind === "declaration").map(e => e.excerpt).join("\n");
    const implementation = unit.excerpts.filter(e => e.kind === "implementation").map(e => e.excerpt).join("\n");
    assert.equal(declaration.includes("static run"), implementation.includes("static run"));
  }
  assert.equal(result.pool.filter(c => c.symbol.includes("run")).length, 2);
});

test("bounded evidence fits the actual pinned Gateway serialization without network access", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await Promise.all(["store.d.ts", "store.js", "context.d.ts"].map(file => rm(join(pkg, "dist", file))));
  await writeFile(join(pkg, "dist/index.d.ts"), Array.from({ length: 32 }, (_, i) => `/** ${"d".repeat(700)} */\nexport declare function run${i}(): void;\n`).join("\n"));
  let captured: { state: unknown; questions: any } | undefined;
  const provider = { evaluate: async (state: unknown, questions: any) => { captured = { state, questions }; return { status: "fallback" as const, reason: "timeout" as const, latencyMs: 0 }; } };
  let estimated = 0;
  for (let padding = 1000; padding <= 1340; padding += 10) {
    await writeFile(join(pkg, "dist/index.js"), Array.from({ length: 32 }, (_, i) => `export function run${i}() {\n return "${"j".repeat(padding)}";\n}\n`).join("\n"));
    await dependencyApiEvidence({ cwd, query: "Session run", mode: "jev", provider });
    estimated = Buffer.byteLength(JSON.stringify({ model: "typesafe-ai/jev", ...captured }));
    if (estimated >= 81_050 && estimated < 85_000) break;
  }
  assert.ok(captured);
  assert.ok(estimated >= 81_050 && estimated < 85_000, "fixture reaches the wire budget boundary");
  const padding = Math.max(0, Math.min(3980, 84_999 - estimated));
  const query = "Session run" + " ".repeat(padding);
  const ranked = await dependencyApiEvidence({ cwd, query, mode: "jev", provider });
  const lexical = await dependencyApiEvidence({ cwd, query, mode: "lexical" });
  assert.equal(ranked.poolDigest, lexical.poolDigest);
  let actualBytes = 0;
  await assert.rejects(evaluateGateway({ provider: "vercel", apiKey: "fixture-no-network" }, captured.state, captured.questions, new AbortController().signal, async (_url, init) => {
    actualBytes = Buffer.byteLength(String(init?.body));
    throw new Error("intercepted locally");
  }));
  assert.ok(actualBytes > 0 && actualBytes <= 85_000, `Gateway serialized ${actualBytes} bytes`);
});

test("cyclic export resolution is disclosed as unknown instead of claiming a partial barrel is complete", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/index.d.ts"), 'export * from "./a.js";\n');
  await writeFile(join(pkg, "dist/a.d.ts"), 'export * from "./b.js";\nexport declare function firstSession(): void;\n');
  await writeFile(join(pkg, "dist/b.d.ts"), 'export * from "./a.js";\nexport declare function lastSession(): void;\n');
  const result = await dependencyApiEvidence({ cwd, query: "Session first last", mode: "lexical" });
  assert.deepEqual(result.unresolvedExportPackages, ["session-engine"]);
  assert.ok(result.pool.every(unit => unit.exportedAs.length === 0));
});

test("getters and setters retain their corresponding implementation", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/store.d.ts"), 'export declare class SessionStore {\n get value(): string;\n set value(next: string);\n}\n');
  await writeFile(join(pkg, "dist/store.js"), 'export class SessionStore {\n get value() { return "GETTER_BODY"; }\n set value(next) { this._value = next; }\n}\n');
  const result = await dependencyApiEvidence({ cwd, query: "SessionStore value", mode: "lexical" });
  const getter = result.pool.find(c => c.symbol === "SessionStore.value [get]");
  const setter = result.pool.find(c => c.symbol === "SessionStore.value [set]");
  assert.ok(getter?.excerpts.some(e => e.kind === "implementation" && e.excerpt.includes("GETTER_BODY")));
  assert.ok(setter?.excerpts.some(e => e.kind === "implementation" && e.excerpt.includes("this._value = next")));
  assert.ok(!getter?.excerpts.some(e => e.kind === "implementation" && e.excerpt.includes("this._value = next")));
});

test("unsupported explicit exports still shadow star-exported symbols", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/ns.d.ts"), 'export declare function helper(): void;\n');
  for (const explicit of ['export * as SessionStore from "./ns.js";', 'export declare const SessionStore: number;', 'export const { nested: [SessionStore] } = { nested: [1] };']) {
    await writeFile(join(pkg, "dist/index.d.ts"), `${explicit}\nexport * from "./store.js";\n`);
    const result = await dependencyApiEvidence({ cwd, query: "SessionStore getBranch", mode: "lexical" });
    const unit = result.pool.find(c => c.symbol === "SessionStore.getBranch");
    assert.ok(unit);
    assert.deepEqual(unit.exportedAs, [], explicit);
  }
});

test("conditional export ordering is honored and unsupported competing conditions remain unknown", async (t) => {
  const { cwd, pkg } = await fixture(t);
  await writeFile(join(pkg, "dist/fallback.js"), 'export function fallbackSession() {}\n');
  for (const rootExport of [
    { node: { types: "./dist/store.d.ts", default: "./dist/store.js" }, default: "./dist/fallback.js" },
    { default: "./dist/fallback.js", types: "./dist/store.d.ts" },
  ]) {
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "session-engine", main: "dist/fallback.js", exports: { ".": rootExport } }));
    const result = await dependencyApiEvidence({ cwd, query: "Session fallback getBranch", mode: "lexical" });
    assert.deepEqual(result.unresolvedExportPackages, ["session-engine"]);
    assert.ok(result.pool.every(unit => unit.exportedAs.length === 0));
  }
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "session-engine", exports: { ".": { default: "./dist/fallback.js", import: "./dist/store.js" } } }));
  const result = await dependencyApiEvidence({ cwd, query: "Session fallback getBranch", mode: "lexical" });
  assert.deepEqual(result.pool.find(c => c.symbol === "fallbackSession")?.exportedAs, ["fallbackSession"]);
  assert.deepEqual(result.pool.find(c => c.symbol === "SessionStore.getBranch")?.exportedAs, []);
});
