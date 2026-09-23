import assert from "node:assert/strict";
import test from "node:test";
import { DecisionEngine } from "../src/decisions.js";
import type { JevResult, Questions } from "../src/jev.js";

const ok = (answers: Extract<JevResult, { status: "ok" }>["answers"]): JevResult => ({ status: "ok", answers, model: "fixture", inputTokens: 10, outputTokens: 0, cached: false, latencyMs: 1 });

test("skill gate can see the eligible roster without sibling questions", async () => {
  let bodyReads = 0;
  const engine = new DecisionEngine({ evaluate: async (state: unknown, questions: Questions) => {
    // Jev evaluates each question using only the shared state and that question.
    const gateInput = JSON.stringify({ state, question: questions.needed });
    assert.ok(gateInput.includes("deck-builder"), "gate must know which skills are available");
    assert.ok(gateInput.includes("Create editable PowerPoint presentations"));
    assert.ok(gateInput.includes("motion-review"));
    assert.ok(gateInput.includes("Inspect animation code and timing"));
    assert.ok(!gateInput.includes("manual-only"));
    assert.ok(!gateInput.includes("/private/skills/"), "shortlist needs descriptions, not local paths");
    return ok({ needed: { type: "noul", noul: 0.1 }, selection: { type: "choice", choice: "s0", probabilities: { s0: 0.8, s1: 0.2 }, confidence: 0.6 } });
  } });
  const result = await engine.recommendSkills("Make an editable pitch deck", [
    { name: "deck-builder", description: "Create editable PowerPoint presentations", filePath: "/private/skills/deck.md" },
    { name: "motion-review", description: "Inspect animation code and timing", filePath: "/private/skills/motion.md" },
    { name: "manual-only", description: "Hidden unless explicitly requested", filePath: "/private/skills/manual.md", disableModelInvocation: true },
  ], async () => { bodyReads++; return "Skill instructions"; });
  assert.deepEqual(result, []);
  assert.equal(bodyReads, 0, "a rejected gate must not load skill bodies");
});

test("skill advice is drawn from eligible candidates and only after body verification", async () => {
  let phase = 0;
  const engine = new DecisionEngine({ evaluate: async (_state: unknown, questions: Questions) => {
    phase++;
    if (phase === 1) {
      const q = questions.selection;
      assert.equal(q?.type, "choice");
      if (q?.type === "choice") assert.equal(Object.keys(q.criteria).length, 2);
      return ok({ needed: { type: "noul", noul: 0.95 }, selection: { type: "choice", choice: "s1", probabilities: { s0: 0.1, s1: 0.9 }, confidence: 0.8 } });
    }
    return ok({ s1: { type: "noul", noul: 0.9 }, s0: { type: "noul", noul: 0.1 } });
  } });
  const result = await engine.recommendSkills("Review animation", [
    { name: "slides", description: "Create slide decks", filePath: "/skills/slides.md", disableModelInvocation: false },
    { name: "motion", description: "Review animations", filePath: "/skills/motion.md", disableModelInvocation: false },
    { name: "hidden", description: "manual only", filePath: "/skills/hidden.md", disableModelInvocation: true },
  ], async () => "Review motion using the code and user requirements.");
  assert.deepEqual(result.map((skill) => skill.name), ["motion"]);
  assert.equal(phase, 2);
});

test("uncertain or unavailable decisions produce no skill recommendation", async () => {
  const engine = new DecisionEngine({ evaluate: async () => ({ status: "fallback", reason: "timeout", latencyMs: 20 }) });
  const result = await engine.recommendSkills("test", [{ name: "a", description: "a", filePath: "/a" }], async () => "a");
  assert.deepEqual(result, []);
});

test("ranking preserves all candidate identities and falls back to original order", async () => {
  const candidates = [
    { id: "c0", path: "a.ts", line: 1, startLine: 1, excerpt: "unrelated" },
    { id: "c1", path: "b.ts", line: 3, startLine: 2, excerpt: "refresh token" },
  ];
  const engine = new DecisionEngine({ evaluate: async () => ok({ c0: { type: "noul", noul: 0.1 }, c1: { type: "noul", noul: 0.9 } }) });
  assert.deepEqual((await engine.rankCode("refresh token", candidates)).map((x) => x.id), ["c1", "c0"]);
  const unavailable = new DecisionEngine({ evaluate: async () => ({ status: "fallback", reason: "timeout", latencyMs: 10 }) });
  assert.deepEqual(await unavailable.rankCode("refresh token", candidates), candidates);
});

test("uncertain failure classification does not invent a root cause", async () => {
  const engine = new DecisionEngine({ evaluate: async () => ok({ category: { type: "choice", choice: "unknown", probabilities: { unknown: 0.55, network: 0.45 }, confidence: 0.1 } }) });
  assert.equal(await engine.triage("bash", "failed", "fix tests"), undefined);
});

test("a wide shortlist is ranked across bounded requests, scoring outlines not excerpts", async () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`, path: `src/f${i}.ts`, line: 1, startLine: 1,
    excerpt: `excerpt ${i} ${"x".repeat(1500)}`, outline: `# src/f${i}.ts\n## definitions\n${"d".repeat(1000)}`,
  }));
  const requests: { bytes: number; ids: string[]; sent: unknown }[] = [];
  let inFlight = 0, maxInFlight = 0;
  const engine = new DecisionEngine({ evaluate: async (state, questions) => {
    requests.push({ bytes: Buffer.byteLength(JSON.stringify({ state, questions })), ids: Object.keys(questions), sent: state });
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return ok(Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: Number(id.slice(1)) / 100 }])));
  } });
  const ranked = await engine.rankCode("find it", candidates);
  assert.ok(requests.length > 1, "a 100-file shortlist must not be sent as one request");
  for (const request of requests) assert.ok(request.bytes <= 32_000, `request of ${request.bytes} bytes exceeds the transport bound`);
  assert.equal(maxInFlight, requests.length, "independent batches are sent concurrently");
  // Every candidate is asked about exactly once, and none is silently dropped.
  assert.deepEqual(requests.flatMap((r) => r.ids).sort(), candidates.map((c) => c.id).sort());
  assert.deepEqual(ranked.map((x) => x.id), [...candidates].reverse().map((x) => x.id));
  // Ranking reads the whole-file outline; the real excerpt still reaches the model.
  const sent = requests[0]!.sent as { candidates: Record<string, { outline?: string; excerpt?: string }> };
  assert.ok(Object.values(sent.candidates).every((entry) => entry.outline !== undefined && entry.excerpt === undefined));
  assert.equal(ranked[0]!.excerpt, candidates[99]!.excerpt);
});

test("a batch the gateway refuses with a 5xx is retried once; other failures are not retried", async () => {
  const candidates = Array.from({ length: 60 }, (_, i) => ({
    id: `c${i}`, path: `src/f${i}.ts`, line: 1, startLine: 1, excerpt: "e", outline: `# src/f${i}.ts\n${"d".repeat(1200)}`,
  }));
  const answer = (questions: Record<string, unknown>) => ok(Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: Number(id.slice(1)) / 100 }])));
  const seen = new Map<string, number>();
  const flaky = new DecisionEngine({ evaluate: async (_state, questions) => {
    const key = Object.keys(questions)[0]!; seen.set(key, (seen.get(key) ?? 0) + 1);
    return key === "c0" && seen.get(key) === 1 ? { status: "fallback", reason: "http_503", latencyMs: 5 } : answer(questions);
  } });
  const ranked = await flaky.rankCode("find it", candidates);
  assert.equal(ranked[0]!.id, "c59", "the retried batch completes the ranking");
  assert.equal(seen.get("c0"), 2);
  let persistent = 0;
  const down = new DecisionEngine({ evaluate: async (_state, questions) => Object.keys(questions)[0] === "c0" ? (persistent++, { status: "fallback", reason: "http_503", latencyMs: 5 }) : answer(questions) });
  assert.deepEqual(await down.rankCode("find it", candidates), candidates);
  assert.equal(persistent, 2, "one retry, not a retry loop");
  let timeouts = 0;
  const slow = new DecisionEngine({ evaluate: async (_state, questions) => Object.keys(questions)[0] === "c0" ? (timeouts++, { status: "fallback", reason: "timeout", latencyMs: 5 }) : answer(questions) });
  assert.deepEqual(await slow.rankCode("find it", candidates), candidates);
  assert.equal(timeouts, 1, "a timeout already spent the deadline and is not retried");
});

test("a failed or incomplete batch discards the whole ranking instead of a partial order", async () => {
  const candidates = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`, path: `src/f${i}.ts`, line: 1, startLine: 1, excerpt: "e", outline: `# src/f${i}.ts\n${"d".repeat(1200)}`,
  }));
  let call = 0;
  const failsLate = new DecisionEngine({ evaluate: async (_state, questions) => ++call === 1
    ? ok(Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.9 }])))
    : { status: "fallback", reason: "timeout", latencyMs: 10 } });
  assert.deepEqual(await failsLate.rankCode("find it", candidates), candidates);
  assert.ok(call > 1);
  const omits = new DecisionEngine({ evaluate: async (_state, questions) => {
    const [first, ...rest] = Object.keys(questions);
    return ok(Object.fromEntries(rest.map((id) => [id, { type: "noul", noul: 0.5 }])));
  } });
  assert.deepEqual(await omits.rankCode("find it", candidates), candidates);
});
