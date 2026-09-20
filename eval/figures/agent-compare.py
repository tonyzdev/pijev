"""Compare arms inside one results directory: headline metrics, paired deltas vs the first arm,
and the localize / comprehend / verify phase split. Usage: compare.py <results root> [arm order]"""
import json, re, statistics as st, sys
root = sys.argv[1]
R = [r for r in json.load(open(f"{root}/results.json"))["records"] if "harnessError" not in r]
for r in R:
    if r["termination"] == "error" and r["exitCode"] == 0: r["termination"] = "completed"
arms = sys.argv[2].split(",") if len(sys.argv) > 2 else sorted({r["arm"] for r in R}, key=lambda a: ["pi", "pij-off", "pij-jev"].index(a) if a in ("pi", "pij-off", "pij-jev") else 9)
by = {}
for r in R: by.setdefault(r["instance_id"], {})[r["arm"]] = r
ids = sorted(i for i, v in by.items() if all(a in v for a in arms))
SEARCH = re.compile(r'(?:^|[\s|;&(])(?:rg|grep|egrep|find|fd|tree)\b|git\s+(?:grep|ls-files)|(?:^|[\s|;&(])ls\b')

def trace_calls(r):
    out = []
    for l in open(f"{root}/{r['instance_id']}/{r['arm']}/trace.jsonl"):
        try: e = json.loads(l)
        except Exception: continue
        if e.get("type") == "tool_execution_start": out.append((e["toolName"], e.get("args", {})))
    return out

def phases(r):
    gold = set(g for g in r["evaluation"]["gold"] if g.endswith(".py")) or set(r["evaluation"]["gold"])
    calls = trace_calls(r); seen = set(); L = C = None
    for i, (t, a) in enumerate(calls):
        s = json.dumps(a)
        if t == "read": seen |= {g for g in gold if g in s}
        if L is None and gold and seen >= gold: L = i + 1
        if C is None and t in ("edit", "write"): C = i + 1
    n = len(calls); Lx = L if L is not None else n; Cx = max(C if C is not None else n, Lx)
    first = calls[0] if calls else None
    return dict(L=Lx, C=Cx - Lx, V=n - Cx, localized=L is not None, firstgold=bool(first and first[0] == "read" and any(g in json.dumps(first[1]) for g in gold)),
                goldreads=sum(1 for t, a in calls if t == "read" and any(g in json.dumps(a) for g in gold)), editsAfterFirst=max(0, sum(1 for t, _ in calls if t in ("edit", "write")) - 1))

def row(r):
    u = r["usage"]; bk = r["byKind"]; e = r["evaluation"]; p = phases(r)
    return dict(ok=e["resolved"], f2p=e["f2pPass"], gold=e["goldTouched"] > 0, budget=r["termination"] == "budget", search=bk.get("search", {}).get("calls", 0), read=bk.get("read", {}).get("calls", 0),
                tools=len(r["calls"]), tok=u["input"] + u["cacheRead"] + u["cacheWrite"], sec=r["elapsedMs"] / 1000, pijev=sum(1 for c in r["calls"] if c["tool"] == ("pij_search", "pijev_search")), jev=r["jev"]["calls"], jevs=r["jev"]["latencyMs"] / 1000, **p)

rows = {i: {a: row(by[i][a]) for a in arms} for i in ids}
print(f"{len(ids)} instances with all arms: {arms}\n")
print(f"{'arm':<9}{'resolved':>9}{'f2p':>6}{'gold':>6}{'budget':>7}{'1st=gold':>9}{'pij':>6}{'search':>9}{'read':>6}{'tools':>7}{'tok':>7}{'secs':>6}{'jev s':>6} | {'L':>5}{'C':>5}{'V':>5}{'L+C':>6}{'goldreads':>10}{'re-edit':>8}")
for a in arms:
    xs = [rows[i][a] for i in ids]; m = lambda k: st.mean(x[k] for x in xs); md = lambda k: st.median(x[k] for x in xs)
    print(f"{a:<9}{sum(x['ok'] for x in xs):>5}/{len(xs):<3}{sum(x['f2p'] for x in xs):>6}{sum(x['gold'] for x in xs):>6}{sum(x['budget'] for x in xs):>7}{sum(x['firstgold'] for x in xs):>9}{sum(x['pij'] for x in xs):>6}{m('search'):>5.1f}/{md('search'):<3.0f}{m('read'):>6.1f}{m('tools'):>7.1f}{m('tok')/1000:>6.0f}k{m('sec'):>6.0f}{m('jevs'):>6.1f} | {m('L'):>5.1f}{m('C'):>5.1f}{m('V'):>5.1f}{m('L')+m('C'):>6.1f}{sum(x['goldreads'] for x in xs):>10}{m('editsAfterFirst'):>8.1f}")
base = arms[0]
print(f"\npaired vs {base}:")
for a in arms[1:]:
    for k, lab in [("search", "search"), ("tools", "tools"), ("tok", "tokens"), ("sec", "seconds"), ("L", "L calls")]:
        p = [(rows[i][base][k], rows[i][a][k]) for i in ids]
        print(f"  {a:<9}{lab:<9} fewer {sum(1 for x, y in p if y < x):>2}  same {sum(1 for x, y in p if y == x):>2}  more {sum(1 for x, y in p if y > x):>2}")
print("\nper instance (search/tools/ctx/outcome):")
print(f"{'instance':<44}" + "".join(f"{a:^20}" for a in arms))
for i in ids:
    print(f"{i:<44}" + "".join(f"{rows[i][a]['search']:>4}{rows[i][a]['tools']:>5}{rows[i][a]['tok']/1000:>5.0f}k {'✓' if rows[i][a]['ok'] else ('B' if rows[i][a]['budget'] else '✗')}    " for a in arms))
