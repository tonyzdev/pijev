import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { loadConfig } from "../src/config.js";
import { DecisionEngine } from "../src/decisions.js";
import { discoverCode } from "../src/discovery.js";
import { JevClient } from "../src/jev.js";
import { firstGoldRank, goldFiles, recallAt } from "./swebench-retrieval.js";

const exec = promisify(execFile);

/** Same instances and ground truth as swebench-retrieval.ts, but driving PiJev's
 * shipped discovery and ranking instead of a standalone harness. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: {
    sample: { type: "string", default: "sample.json" }, repos: { type: "string", default: "repos" },
    out: { type: "string", default: "swebench-pipeline-results" },
  } });
  const sample = JSON.parse(await readFile(values.sample!, "utf8")) as { repo: string; instance_id: string; base_commit: string; problem_statement: string; patch: string; difficulty: string }[];
  const client = new JevClient({ ...loadConfig({ ...process.env, PIJEV_JEV_PROVIDER: "vercel" }), timeoutMs: 30_000 });
  await mkdir(values.out!, { recursive: true });
  const records = [];
  for (const inst of sample) {
    const repo = join(values.repos!, inst.repo.split("/")[1]!);
    const gold = goldFiles(inst.patch);
    await exec("git", ["checkout", "-q", "--force", inst.base_commit], { cwd: repo });
    const query = inst.problem_statement.slice(0, 2000);
    const decisions: { status: string; inputTokens: number; outputTokens: number; latencyMs: number }[] = [];
    const engine = new DecisionEngine(client, ({ result }) => {
      decisions.push({ status: result.status === "ok" ? "ok" : `fallback:${result.reason}`,
        inputTokens: result.status === "ok" ? result.inputTokens : 0, outputTokens: result.status === "ok" ? result.outputTokens : 0, latencyMs: result.latencyMs });
    });
    const t0 = performance.now();
    const found = await discoverCode({ cwd: repo, query });
    const discoverMs = Math.round(performance.now() - t0);
    const pool = found.candidates.map(c => c.path);
    const t1 = performance.now();
    const ranked = await engine.rankCode(query, found.candidates, undefined, "source_briefing");
    const rankMs = Math.round(performance.now() - t1);
    const order = ranked.map(c => c.path);
    const applied = ranked.some(c => c.relevance !== undefined);
    // What reaching the gold file would cost a model that reads down the ranking
    // itself: one tool call per file, and that file's text in its context.
    const bytes = new Map<string, number>();
    for (const path of pool) bytes.set(path, await stat(join(repo, path)).then(s => s.size).catch(() => 0));
    const readCost = (ordering: string[]) => {
      const depth = ordering.findIndex(p => gold.includes(p));
      if (depth < 0) return null;
      const opened = ordering.slice(0, depth + 1);
      return { calls: opened.length, fileBytes: opened.reduce((sum, p) => sum + (bytes.get(p) ?? 0), 0),
        excerptBytes: opened.reduce((sum, p) => sum + Math.min(1800, bytes.get(p) ?? 0), 0) };
    };
    const ks = [1, 5, 10, 20, 100];
    const rec = {
      instance_id: inst.instance_id, repo: inst.repo, difficulty: inst.difficulty, gold,
      filesScanned: found.filesScanned, shortlist: pool.length, truncated: found.truncated,
      goldInShortlist: gold.filter(g => pool.includes(g)).length,
      bm25: { recall: Object.fromEntries(ks.map(k => [k, recallAt(pool, gold, k)])), firstGoldRank: firstGoldRank(pool, gold) },
      jev: { applied, recall: Object.fromEntries(ks.map(k => [k, recallAt(order, gold, k)])), firstGoldRank: firstGoldRank(order, gold) },
      readCost: { bm25: readCost(pool), jev: readCost(order) },
      decisions, discoverMs, rankMs, topBm25: pool.slice(0, 10), topJev: order.slice(0, 10),
      ranking: order.map((path, i) => ({ path, jevRank: i + 1, bm25Rank: pool.indexOf(path) + 1, bytes: bytes.get(path) ?? 0, gold: gold.includes(path) })),
    };
    records.push(rec);
    console.log(`${rec.instance_id.padEnd(24)} scan=${String(rec.filesScanned).padStart(5)} shortlist=${String(rec.shortlist).padStart(3)} inList=${rec.goldInShortlist}/${gold.length}`
      + ` | bm25 r@10=${rec.bm25.recall[10]!.toFixed(2)} rank=${rec.bm25.firstGoldRank ?? "-"}`
      + ` | jev r@10=${rec.jev.recall[10]!.toFixed(2)} rank=${rec.jev.firstGoldRank ?? "-"}`
      + ` | ${decisions.length}req ${discoverMs}+${rankMs}ms`);
    await writeFile(join(values.out!, "results.json"), JSON.stringify({ pipeline: "pijev", records }, null, 1));
  }
}
