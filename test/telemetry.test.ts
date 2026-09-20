import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DecisionJournal, readRecentDecisions } from "../src/telemetry.js";
import { formatDecisions } from "../src/ui.js";

test("journals only decision metadata, including cache and fallback state", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pijev-journal-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const journal = new DecisionJournal(home);
  await journal.record("assist", { kind: "skill_shortlist", questionCount: 2, result: {
    status: "ok", model: "jev-test", answers: { secret_source: { type: "noul", noul: 0.9 } }, latencyMs: 42, cached: false, inputTokens: 200, outputTokens: 0,
  } });
  await journal.record("observe", { kind: "code_rank", questionCount: 3, result: { status: "fallback", reason: "timeout", latencyMs: 100 } });
  const entries = await readRecentDecisions(home);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.kind, "skill_shortlist");
  assert.equal(entries[1]?.reason, "timeout");
  const paths = await readdir(join(home, "decisions"));
  const content = await readFile(join(home, "decisions", paths[0]!), "utf8");
  assert.ok(!content.includes("secret_source"));
  assert.equal(journal.summary().inputTokens, 200);
  assert.equal(journal.summary().fallbacks, 1);
  assert.equal(entries[0]?.sessionId, undefined);
  assert.equal(formatDecisions(entries).includes("session="), false);
});

test("decision scopes retain only runtime identifiers and are readable beside legacy records", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pijev-scoped-journal-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const journal = new DecisionJournal(home);
  const observation = { kind: "code_rank" as const, questionCount: 2, result: { status: "fallback" as const, reason: "timeout" as const, latencyMs: 1 } };
  await journal.record("assist", observation);
  const scope = { sessionId: "session-fixture", userMessageId: "user-fixture", prompt: "PRIVATE_PROMPT_MUST_NOT_BE_SAVED" };
  await journal.record("assist", observation, scope);
  const records = await readRecentDecisions(home);
  assert.equal(records.length, 2);
  assert.equal(records[0]?.sessionId, undefined);
  assert.equal(records[1]?.sessionId, scope.sessionId);
  assert.equal(records[1]?.userMessageId, scope.userMessageId);
  const text = formatDecisions(records);
  assert.ok(text.includes("session=session-fixture") && text.includes("user=user-fixture"));
  const files = await readdir(join(home, "decisions"));
  assert.ok(!(await readFile(join(home, "decisions", files[0]!), "utf8")).includes(scope.prompt));
});
