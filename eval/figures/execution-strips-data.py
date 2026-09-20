"""Export every tool call of every paired run (Pi vs PiJev + Jev) as a compact sequence, for
execution-strips.py. Reads the raw run directories (trace.jsonl per run); writes
eval/swebench-agent-results/execution-strips.json."""
import json, re, sys, os
SC = "/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad"
OUT = os.path.join(os.path.dirname(__file__), "..", "swebench-agent-results", "execution-strips.json")
SETS = {
    "unfamiliar-flash": dict(pi="agent-unfamiliar", pijev="agent-unfamiliar", model="deepseek-v4-flash",
        title="13 个陌生仓库任务 · 每次工具调用一格", footnote="任务按 Pi 的调用数降序 · 主模型 DeepSeek v4-flash · 预算 600k token / 40 轮 / 9 分钟 · 陌生仓库 = 2025 年中以后创建、不在模型训练数据里的项目",
        title_en="13 tasks in unfamiliar repositories · one block per tool call", footnote_en="Tasks in descending order of Pi's call count · main model DeepSeek v4-flash · budget 600k tokens / 40 turns / 9 min · unfamiliar = repositories created after mid-2025, outside the model's training data"),
    "unfamiliar-pro": dict(pi="agent-unfamiliar-pro", pijev="agent-unfamiliar-pro", model="deepseek-v4-pro",
        title="13 个陌生仓库任务 · 每次工具调用一格", footnote="任务按 Pi 的调用数降序 · 主模型 DeepSeek v4-pro · 预算 600k token / 40 轮 / 9 分钟 · 陌生仓库 = 2025 年中以后创建、不在模型训练数据里的项目",
        title_en="13 tasks in unfamiliar repositories · one block per tool call", footnote_en="Tasks in descending order of Pi's call count · main model DeepSeek v4-pro · budget 600k tokens / 40 turns / 9 min · unfamiliar = repositories created after mid-2025, outside the model's training data"),
    "django": dict(pi="agent-main", pijev="agent-main-v4", model="deepseek-v4-flash",
        title="20 个 SWE-bench Verified django 任务 · 每次工具调用一格", footnote="任务按 Pi 的调用数降序 · 主模型 DeepSeek v4-flash · 预算 600k token / 40 轮 / 9 分钟 · PiJev 为 v4（整文件 briefing）配置",
        title_en="20 SWE-bench Verified django tasks · one block per tool call", footnote_en="Tasks in descending order of Pi's call count · main model DeepSeek v4-flash · budget 600k tokens / 40 turns / 9 min · PiJev is the v4 configuration (whole top file in the briefing)"),
}
SHORT = {"openonion__connectonion": "connectonion", "mubaraknumann__unifideck": "unifideck", "pinchbench__skill": "pinchbench/skill", "air-embodied-brain__Zetta-Embodiment": "Zetta-Embodiment", "stabldev__torrra": "torrra", "2akouwu__reverify": "reverify", "sentient-agi__EvoSkill": "EvoSkill", "django__django": "django"}
SEARCH = re.compile(r'(?:^|[\s|;&(])(?:rg|grep|egrep|find|fd|tree)\b|git\s+(?:grep|ls-files)|(?:^|[\s|;&(])ls\b')
def kind(t, a):
    if t in ("pij_search", "pijev_search"): return "search"
    if t == "read": return "read"
    if t in ("edit", "write"): return "edit"
    c = a.get("command", "") if t == "bash" else ""
    if re.search(r'runtests\.py|pytest|\bnode\b[^|;&]*\s--test\b|\btsx\s+--test\b|\b(?:pnpm|npm)\s+(?:run\s+)?test\b', c): return "test"
    if SEARCH.search(c): return "search"
    if re.search(r'(?:^|[\s|;&(])(?:cat|head|tail|wc)\b|sed\s+-n|git\s+(?:show|log|diff)', c): return "read"
    return "other"
def run(root, r):
    gold = [g for g in r["evaluation"]["gold"] if g.endswith((".py", ".ts", ".tsx", ".js", ".mjs", ".sql"))] or r["evaluation"]["gold"]; calls = []
    for l in open(f"{SC}/{root}/{r['instance_id']}/{r['arm']}/trace.jsonl"):
        try: e = json.loads(l)
        except Exception: continue
        if e.get("type") != "tool_execution_start": continue
        a = e.get("args", {}); s = json.dumps(a)
        # gold = this read/edit names a file the reference patch edits (bash reads are not counted, as in phases.json)
        calls.append({"kind": kind(e["toolName"], a), "gold": e["toolName"] in ("read", "edit") and any(g in s for g in gold)})
    term = "completed" if r["termination"] == "error" and r["exitCode"] == 0 else r["termination"]
    return {"calls": calls, "resolved": r["evaluation"]["resolved"], "termination": term, "tokens": r["usage"]["input"] + r["usage"]["cacheRead"] + r["usage"]["cacheWrite"]}
out = {}
for name, s in SETS.items():
    recs = {}
    for arm, root in (("pi", s["pi"]), ("pij-jev", s["pij"])):
        for r in json.load(open(f"{SC}/{root}/results.json"))["records"]:
            if "harnessError" in r or r["arm"] != arm: continue
            recs.setdefault(r["instance_id"], {})[arm] = run(root, r)
    tasks = []
    for iid, arms in recs.items():
        if "pi" not in arms or "pij-jev" not in arms: continue
        repo, num = iid.rsplit("-", 1)
        tasks.append({"id": iid, "name": f"{SHORT[repo]} #{num}", "pi": arms["pi"], "pij": arms["pij-jev"]})
    tasks.sort(key=lambda x: -len(x["pi"]["calls"]))
    out[name] = {"title": s["title"], "footnote": s["footnote"], "title_en": s["title_en"], "footnote_en": s["footnote_en"], "model": s["model"], "tasks": tasks}
    print(name, len(tasks), "tasks")
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
