import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { JevClient, type JevResult, type Questions } from "../src/jev.js";

// This is a feasibility probe, not a runtime completion gate. Default: replay
// the committed snapshot without a key, a network request, or executing tests.
const { values } = parseArgs({ options: { live: { type: "boolean", default: false } } });
const directory = join(dirname(fileURLToPath(import.meta.url)), "evidence");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const read = (name: string) => readFile(join(directory, name), "utf8");
const [protocolText, fixtureText] = await Promise.all([read("protocol.json"), read("cases.json")]);
const manifest = JSON.parse(await read("manifest.json")) as Record<string, string>;
const verifyArtifact = (name: string, text: string) => assert.equal(hash(text), manifest[name], `Frozen artifact changed: ${name}`);
verifyArtifact("protocol.json", protocolText);
verifyArtifact("cases.json", fixtureText);
const protocol = JSON.parse(protocolText) as { repetitions: number; questions: Questions };
const cases = JSON.parse(fixtureText) as { id: string; requirement: string; files: { path: string; source: string }[] }[];
const protocolHash = hash(protocolText);
const ids = new Set(cases.map((item) => item.id));
assert.equal(ids.size, cases.length, "Case IDs must be unique");
assert.ok(cases.length > 0 && cases.length <= 32);
assert.ok(Number.isSafeInteger(protocol.repetitions) && protocol.repetitions > 0 && protocol.repetitions <= 3);
for (const item of cases) {
  assert.ok(typeof item.requirement === "string" && Array.isArray(item.files));
  assert.ok(item.files.every((file) => typeof file.path === "string" && typeof file.source === "string"));
  assert.ok(Buffer.byteLength(JSON.stringify(item)) <= 64000);
}
type Row = { id: string; repetition: number; result: JevResult };
let rows: Row[];
if (values.live) {
  const config = loadConfig();
  assert.ok(config.apiKey, "Load a Jev provider key before using --live");
  const output = join(directory, "../../.pijev/evidence-probes", `${new Date().toISOString().replaceAll(":", "-")}.json`);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  rows = [];
  const persist = () => writeFile(output, JSON.stringify({ protocolHash, fixtureHash: hash(fixtureText), provider: config.provider, model: config.model, rows }, null, 2), { mode: 0o600 });
  await persist();
  for (let repetition = 0; repetition < protocol.repetitions; repetition++) {
    for (const item of cases) {
      // Fresh clients ensure repetition measures another request, not a cache hit.
      const result = await new JevClient(config).evaluate({ requirement: item.requirement, files: item.files }, protocol.questions);
      rows.push({ id: item.id, repetition, result });
      await persist();
      console.log(JSON.stringify({ id: item.id, repetition, status: result.status, latencyMs: result.latencyMs }));
    }
  }
  console.log(`Saved ${output}`);
} else {
  const snapshotText = await read("snapshot.json");
  verifyArtifact("snapshot.json", snapshotText);
  const snapshot = JSON.parse(snapshotText) as { protocolHash: string; rows: Row[] };
  assert.equal(snapshot.protocolHash, protocolHash, "Snapshot protocol differs from the supplied question");
  rows = snapshot.rows;
}

// Labels are read only after all responses are persisted. Never send them to Jev.
const labelsText = await read("labels.json");
verifyArtifact("labels.json", labelsText);
const labels = JSON.parse(labelsText) as { id: string; expected: string }[];
assert.equal(labels.length, cases.length);
assert.deepEqual(new Set(labels.map((label) => label.id)), ids);
assert.equal(rows.length, cases.length * protocol.repetitions);
const seen = new Set<string>();
const matrix: Record<string, Record<string, number>> = {};
let matches = 0;
let fallbacks = 0;
let inputTokens = 0;
let outputTokens = 0;
const mismatches: { id: string; repetition: number; expected: string; actual: string }[] = [];
for (const row of rows) {
  assert.ok(ids.has(row.id) && Number.isInteger(row.repetition) && row.repetition >= 0 && row.repetition < protocol.repetitions);
  const key = `${row.id}:${row.repetition}`;
  assert.ok(!seen.has(key), "Duplicate response");
  seen.add(key);
  const expected = labels.find((label) => label.id === row.id)!.expected;
  const answer = row.result.status === "ok" ? row.result.answers.coverage : undefined;
  const actual = answer?.type === "choice" ? answer.choice : "fallback";
  matrix[expected] ??= {};
  matrix[expected]![actual] = (matrix[expected]![actual] ?? 0) + 1;
  if (actual === expected) matches++;
  else mismatches.push({ id: row.id, repetition: row.repetition, expected, actual });
  if (row.result.status === "fallback") fallbacks++;
  else { inputTokens += row.result.inputTokens; outputTokens += row.result.outputTokens; }
}
const latencies = rows.map((row) => row.result.latencyMs).sort((a, b) => a - b);
const middle = Math.floor(latencies.length / 2);
console.log(JSON.stringify({
  mode: values.live ? "live" : "snapshot", protocolHash, fixtureHash: hash(fixtureText),
  distinctCases: cases.length, responses: rows.length, labelMatches: matches, fallbacks, matrix, mismatches,
  inputTokens, outputTokens,
  latencyMs: { min: latencies[0], median: latencies.length % 2 ? latencies[middle] : (latencies[middle - 1]! + latencies[middle]!) / 2, max: latencies.at(-1), sum: latencies.reduce((sum, value) => sum + value, 0) },
  caveat: "Repeated responses are not independent cases. Cases c07/c10 expose ambiguity in the original unknown-evidence rubric; see docs/evidence-probe.md. No test was executed by this probe.",
}, null, 2));
