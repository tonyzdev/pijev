"""Summarize the shortlist ablation: how many BM25 candidates Jev must score before the briefing's top files stop
improving, and what each size costs. Inputs are eval/swebench-pipeline.ts runs, one directory per (set, size):
<scratch>/ablation/swe-k{K}/results.json and <scratch>/private-repo/retrieval-k{K}/results.json.
Writes eval/swebench-pipeline-results/shortlist-ablation.json. The private repository is reported only as
aggregates and anonymous per-task ranks — no paths, PR numbers or text."""
import json, os, statistics as st
SCRATCH = os.environ.get("PIJ_SCRATCH", "/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "swebench-pipeline-results", "shortlist-ablation.json")
SETS = {"swebench": f"{SCRATCH}/ablation/swe-k{{k}}", "private": f"{SCRATCH}/private-repo/retrieval-k{{k}}"}
SIZES = [100, 50, 30, 20]
JEV_USD_PER_M = 0.28   # measured from the gateway balance, input tokens dominate
def summarize(records):
    ok = [r for r in records if r["jev"]["applied"]]
    n = len(records)
    def side(key):
        ranks = [r[key]["firstGoldRank"] for r in ok]
        return {"recall@1": st.mean(r[key]["recall"]["1"] for r in ok), "recall@5": st.mean(r[key]["recall"]["5"] for r in ok),
                "recall@10": st.mean(r[key]["recall"]["10"] for r in ok), "rank1": sum(1 for x in ranks if x == 1),
                "top5": sum(1 for x in ranks if x is not None and x <= 5), "missed": sum(1 for x in ranks if x is None),
                "medianFirstGold": st.median([x if x is not None else 999 for x in ranks]) if ranks else None}
    tok = [sum(d["inputTokens"] for d in r["decisions"]) for r in ok]
    return {"tasks": n, "ranked": len(ok), "bm25": side("bm25"), "jev": side("jev"),
            "jevInputTokens": st.mean(tok) if tok else None, "jevUsd": st.mean(tok) * JEV_USD_PER_M / 1e6 if tok else None,
            "requests": st.mean(len(r["decisions"]) for r in ok) if ok else None, "retriedTasks": sum(1 for r in ok if r.get("attempts", 1) > 1),
            "rankMsMedian": st.median(r["rankMs"] for r in ok) if ok else None,
            "perTask": [{"task": i + 1, "gold": len(r["gold"]), "bm25": r["bm25"]["firstGoldRank"], "jev": r["jev"]["firstGoldRank"] if r["jev"]["applied"] else "unranked"} for i, r in enumerate(records)]}
out = {}
for name, pattern in SETS.items():
    for k in SIZES:
        p = os.path.join(pattern.format(k=k), "results.json")
        if not os.path.exists(p): continue
        out.setdefault(name, {})[str(k)] = summarize(json.load(open(p))["records"])
json.dump(out, open(OUT, "w"), indent=1)
for name, by in out.items():
    print(f"\n{name}")
    print(f"{'K':>4} {'ranked':>7} | {'BM25 r@1':>8} {'rank1':>5} {'top5':>5} | {'Jev r@1':>7} {'r@5':>5} {'rank1':>5} {'top5':>5} {'miss':>4} {'med':>4} | {'tok':>6} {'$/task':>7} {'req':>4} {'retry':>5} {'ms':>6}")
    for k, s in by.items():
        b, j = s["bm25"], s["jev"]
        print(f"{k:>4} {s['ranked']:>3}/{s['tasks']:<3} | {b['recall@1']:>8.2f} {b['rank1']:>5} {b['top5']:>5} | {j['recall@1']:>7.2f} {j['recall@5']:>5.2f} {j['rank1']:>5} {j['top5']:>5} {j['missed']:>4} {j['medianFirstGold']:>4} | {s['jevInputTokens']/1000:>5.1f}k {s['jevUsd']:>7.4f} {s['requests']:>4.1f} {s['retriedTasks']:>5} {s['rankMsMedian']:>6.0f}")
