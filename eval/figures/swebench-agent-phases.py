import json, re, statistics as st
SC="/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad"
import sys
ARMS=[("pi","agent-main"),("pij-off","agent-main-v2"),("pij-jev","agent-main-v2")]+([("pij-jev","agent-main-v3")] if len(sys.argv)>1 else [])
SEARCH=re.compile(r'(?:^|[\s|;&(])(?:rg|grep|egrep|find|fd|tree)\b|git\s+(?:grep|ls-files)|(?:^|[\s|;&(])ls\b')
def kind(t,a):
    if t in ("pij_search", "pijev_search"): return "search"
    if t=="read": return "read"
    if t in("edit","write"): return "edit"
    c=a.get("command","") if t=="bash" else ""
    if re.search(r'runtests\.py|pytest|\bnode\b[^|;&]*\s--test\b|\btsx\s+--test\b|\b(?:pnpm|npm)\s+(?:run\s+)?test\b',c): return "test"
    if SEARCH.search(c): return "search"
    if re.search(r'(?:^|[\s|;&(])(?:cat|head|tail|wc)\b|sed\s+-n|git\s+(?:show|log|diff)',c): return "read"
    return "other"
def phases(root, r):
    gold=set(r["evaluation"]["gold"]); d=f"{SC}/{root}/{r['instance_id']}/{r['arm']}"
    ev=[json.loads(l) for l in open(f"{d}/trace.jsonl") if l.startswith("{")]
    calls=[]; ctx_after=[]   # per tool call: kind, gold-touch, result bytes; and prompt tokens of the next assistant turn
    pending=[]; seen_gold=set(); L_end=None; C_end=None; ctx_now=0
    for e in ev:
        t=e.get("type")
        if t=="tool_execution_start":
            a=e.get("args",{}); k=kind(e["toolName"],a); s=json.dumps(a)
            hits={g for g in gold if g in s}
            if e["toolName"]=="read": seen_gold|=hits
            calls.append(dict(kind=k, tool=e["toolName"], goldread=bool(hits) and e["toolName"]=="read", bytes=0, id=e.get("toolCallId")))
            if L_end is None and gold and seen_gold>=gold: L_end=len(calls)
            if C_end is None and k=="edit": C_end=len(calls)
        elif t=="tool_execution_end":
            for c in calls[::-1]:
                if c["id"]==e.get("toolCallId"): c["bytes"]=len(json.dumps(e.get("result",""))); break
        elif t=="message_end" and e["message"].get("role")=="assistant":
            u=e["message"].get("usage",{}); ctx_now=(u.get("input") or 0)+(u.get("cacheRead") or 0)+(u.get("cacheWrite") or 0)
            ctx_after.append((len(calls), ctx_now))
    n=len(calls)
    def ctx_at(i):  # prompt tokens of the first assistant turn issued after tool call #i
        for k,c in ctx_after:
            if k>=i and c>0: return c
        return ctx_after[-1][1] if ctx_after else 0
    seg=lambda a,b: calls[a:b]
    def stats(cs): return dict(calls=len(cs), search=sum(c["kind"]=="search" for c in cs), read=sum(c["kind"]=="read" for c in cs), test=sum(c["kind"]=="test" for c in cs), edit=sum(c["kind"]=="edit" for c in cs), bytes=sum(c["bytes"] for c in cs), nongold_bytes=sum(c["bytes"] for c in cs if not c["goldread"]))
    Lend = L_end if L_end is not None else n; Cend = C_end if C_end is not None else n
    Cend = max(Cend, Lend)
    return dict(id=r["instance_id"][-5:], arm=r["arm"], ok=r["evaluation"]["resolved"], localized=L_end is not None, edited=C_end is not None,
                L=stats(seg(0,Lend)) | {"ctx":ctx_at(Lend)}, C=stats(seg(Lend,Cend)) | {"ctx":ctx_at(Cend)}, V=stats(seg(Cend,n)) | {"ctx":ctx_at(n)}, gold=len(gold),
                reads=[c for c in calls if c["tool"]=="read"], goldreads=sum(c["goldread"] for c in calls))
rows={}
for arm,root in ARMS:
    for r in json.load(open(f"{SC}/{root}/results.json"))["records"]:
        if r.get("arm")==arm: rows[(r["instance_id"],arm+("(v3)" if root.endswith("v3") else ""))]=phases(root,r)
ids=sorted({k[0] for k in rows})
m=lambda xs: st.mean(xs) if xs else 0; md=lambda xs: st.median(xs) if xs else 0
print(f"{'':<9}{'L 定位 (→ 读完所有 gold)':^44}|{'C 理解 (→ 第一次 edit)':^30}|{'V 验证 (edit → 结束)':^30}|")
print(f"{'arm':<9}{'localized':>9}{'calls':>7}{'search':>7}{'ctx@L':>9}{'wasteKB':>9}|{'calls':>7}{'search':>7}{'ctx@C':>9}{'':>6}|{'calls':>7}{'test':>6}{'edit':>6}{'ctx@end':>10}|{'resolved':>9}")
LAB=[a+("(v3)" if r.endswith("v3") else "") for a,r in ARMS]
for arm in LAB:
    xs=[rows[(i,arm)] for i in ids]; loc=[x for x in xs if x["localized"]]
    print(f"{arm:<9}{sum(x['localized'] for x in xs):>6}/20{m([x['L']['calls'] for x in loc]):>5.1f}/{md([x['L']['calls'] for x in loc]):<2.0f}{m([x['L']['search'] for x in loc]):>5.1f}/{md([x['L']['search'] for x in loc]):<2.0f}{m([x['L']['ctx'] for x in loc])/1000:>7.0f}k{m([x['L']['nongold_bytes'] for x in loc])/1024:>8.1f}|{m([x['C']['calls'] for x in loc]):>5.1f}/{md([x['C']['calls'] for x in loc]):<2.0f}{m([x['C']['search'] for x in loc]):>5.1f}/{md([x['C']['search'] for x in loc]):<2.0f}{m([x['C']['ctx'] for x in loc])/1000:>7.0f}k{'':>6}|{m([x['V']['calls'] for x in loc]):>5.1f}/{md([x['V']['calls'] for x in loc]):<2.0f}{m([x['V']['test'] for x in loc]):>6.1f}{m([x['V']['edit'] for x in loc]):>6.1f}{m([x['V']['ctx'] for x in loc])/1000:>8.0f}k|{sum(x['ok'] for x in xs):>6}/20")
print("\n(calls/search 为 均值/中位数 · ctx@X = 该阶段结束时那一轮请求的 prompt tokens · wasteKB = 定位阶段吞进上下文的非 gold 文件工具输出)\n")
print("read precision（读过的文件里 gold 占比）:")
for arm in LAB:
    xs=[rows[(i,arm)] for i in ids]; tot=sum(len(x["reads"]) for x in xs); g=sum(x["goldreads"] for x in xs)
    print(f"  {arm:<9} {g}/{tot} = {g/tot:.0%}")
print("\nper-instance L phase (calls→localized, ctx@L k):")
print(f"{'inst':<7}"+"".join(f"{a:>16}" for a in LAB))
for i in ids:
    print(f"{i[-5:]:<7}"+"".join((f"{rows[(i,a)]['L']['calls']:>6} {rows[(i,a)]['L']['ctx']/1000:>5.0f}k {'✓' if rows[(i,a)]['ok'] else '✗'} " if rows[(i,a)]['localized'] else f"{'—':>6} {'':>6}   ") for a in LAB))
json.dump({f"{k[0]}|{k[1]}":v for k,v in rows.items()}, open(f"{SC}/phases.json","w"), default=lambda o: None)
