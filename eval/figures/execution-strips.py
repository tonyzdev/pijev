"""Execution strips: every tool call of every run as one block, Pi above PiJev + Jev per task.
Reads eval/swebench-agent-results/execution-strips.json (see execution-strips-data.py).
Usage: execution-strips.py <set> <out.html> [en|zh]   sets: unfamiliar-flash | unfamiliar-pro | django"""
import json, os, statistics as st, sys
D = json.load(open(os.path.join(os.path.dirname(__file__), "..", "swebench-agent-results", "execution-strips.json")))[sys.argv[1]]
tasks = D["tasks"]; LANG = sys.argv[3] if len(sys.argv) > 3 else "en"
S = {"en": dict(legend=[("search", "search (grep / rg / pijev_search)"), ("read", "read"), ("edit", "edit"), ("test", "test"), ("other", "other bash")],
        brief="Jev-ranked briefing (not a call; in the first prompt)", frame="white frame = first touch of a file the reference patch edits",
        sub="One block per tool call, left to right in time; per task the top strip is plain Pi, the bottom PiJev + Jev; each row ends with its call count and outcome",
        ok="✓ resolved", budget="budget", fail="✗", title=D["title_en"], footnote=D["footnote_en"]),
     "zh": dict(legend=[("search", "搜索（grep / rg / pijev_search）"), ("read", "读文件"), ("edit", "改代码"), ("test", "跑测试"), ("other", "其他 bash")],
        brief="Jev 排序的 briefing（不是调用，进第一轮 prompt）", frame="白框 = 这一步第一次碰到目标文件",
        sub="每格一次工具调用，从左到右按时间；每个任务上面一条是 Pi，下面一条是 PiJev + Jev；行尾是调用总数和结果",
        ok="✓ 解决", budget="撞预算", fail="✗", title=D["title"], footnote=D["footnote"])}[LANG]
COL = {"search": "#3987e5", "read": "#199e70", "edit": "#eb6834", "test": "#c98500", "other": "#555a5e"}
PANEL, BORDER = "#1e1e1e", "#3a3a3a"; INK, INK2, INK3 = "#ededed", "#b4b4b4", "#8c8c8c"; JEV = "#d55181"
SANS = "'Helvetica Neue',Helvetica,Arial,'PingFang SC',sans-serif"
W = 1672; LBL = 232; X0 = LBL + 70; BW = 14; GAP = 3; RH = 20; PAIR = RH * 2 + 6; ROW = PAIR + 16; T = 124
H = T + len(tasks) * ROW + 56
o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{SANS}">', f'<rect width="{W}" height="{H}" rx="6" fill="{PANEL}" stroke="{BORDER}" stroke-width="1.5"/>']
def t(x, y, s, fill=INK2, size=14, weight="400", anchor="start"): o.append(f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{s}</text>')
wid = lambda s, size: sum((size * 0.55 if ord(c) < 128 else size) for c in s)
def firstgold(calls):
    return next((i + 1 for i, c in enumerate(calls) if c["gold"]), None)
# headline numbers
n = len(tasks); P = [x["pi"]["calls"] for x in tasks]; J = [x["pij"]["calls"] for x in tasks]
shorter = sum(1 for a, b in zip(P, J) if len(b) < len(a)); pct = 100 * (1 - sum(map(len, J)) / sum(map(len, P)))
fg = {"pi": [firstgold(c) for c in P], "pij": [firstgold(c) for c in J]}
med = {a: st.median([x for x in v if x]) for a, v in fg.items()}
sooner = sum(1 for a, b in zip(fg["pi"], fg["pij"]) if a and b and b < a)
res = {a: sum(x[a]["resolved"] for x in tasks) for a in ("pi", "pij")}
t(22, 34, S["title"], INK, 19, "600")
B = lambda v: f'<tspan fill="{INK}" font-weight="600">{v}</tspan>'
head = (f'shorter strip on {B(f"{shorter}/{n}")} tasks, {B(f"−{pct:.0f}%")} calls in total · reaches a gold file sooner on {B(f"{sooner}/{n}")} (median step {med["pij"]:.0f} vs {med["pi"]:.0f}) · resolved {B(f"{res["pij"]} vs {res["pi"]}")}' if LANG == "en"
        else f'带子更短 {B(f"{shorter}/{n}")} 个任务，总调用 {B(f"−{pct:.0f}%")} · 更早碰到目标文件 {B(f"{sooner}/{n}")}（中位第 {med["pij"]:.0f} 步 vs 第 {med["pi"]:.0f} 步）· 解决 {B(f"{res["pij"]} vs {res["pi"]}")}')
o.append(f'<text x="{W-22}" y="34" fill="{INK2}" font-size="14" text-anchor="end">{head}</text>')
lx = 22
for k, lab in S["legend"]:
    o.append(f'<rect x="{lx}" y="54" width="14" height="14" rx="2" fill="{COL[k]}"/>'); t(lx + 20, 66, lab, INK2, 14); lx += 20 + wid(lab, 14) + 26
o.append(f'<rect x="{lx}" y="54" width="14" height="14" rx="2" fill="{JEV}"/>'); lab = S["brief"]; t(lx + 20, 66, lab, INK2, 14); lx += 20 + wid(lab, 14) + 26
o.append(f'<rect x="{lx}" y="53" width="16" height="16" rx="2" fill="none" stroke="#ffffff" stroke-width="2"/>'); t(lx + 22, 66, S["frame"], INK2, 14)
t(22, 98, S["sub"], INK3, 13)
for i, task in enumerate(tasks):
    y0 = T + i * ROW
    t(LBL - 8, y0 + PAIR / 2 + 5, task["name"], INK2, 14, "400", "end")
    if i % 2 == 0: o.append(f'<rect x="12" y="{y0-6}" width="{W-24}" height="{ROW}" fill="#ffffff" fill-opacity="0.025"/>')
    for j, arm in enumerate(("pi", "pij")):
        r = task[arm]; cs = r["calls"]; y = y0 + j * (RH + 6); x = X0
        t(X0 - 8, y + RH - 5, "Pi" if arm == "pi" else "PiJev", INK3 if arm == "pi" else JEV, 12, "500", "end")
        if arm == "pij": o.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{RH}" rx="2" fill="{JEV}"/>'); x += BW + GAP
        seen = False
        for c in cs:
            o.append(f'<rect x="{x}" y="{y}" width="{BW}" height="{RH}" rx="2" fill="{COL[c["kind"]]}"/>')
            if c["gold"] and not seen: o.append(f'<rect x="{x-2}" y="{y-2}" width="{BW+4}" height="{RH+4}" rx="3" fill="none" stroke="#ffffff" stroke-width="2"/>'); seen = True
            x += BW + GAP
        ok = r["resolved"]; budget = r["termination"] == "budget"
        t(x + 8, y + RH - 5, f"{len(cs)}  {S['ok'] if ok else (S['budget'] if budget else S['fail'])}", INK if ok else INK3, 12.5, "600" if ok else "400")
t(22, H - 16, S["footnote"], INK3, 12.5)
o.append("</svg>")
open(sys.argv[2], "w").write('<style>*{margin:0;padding:0}html,body{background:#abbab9}body{padding:36px}</style>\n' + "\n".join(o))
print(sys.argv[1], W, H, f"shorter {shorter}/{n} calls -{pct:.0f}% sooner {sooner}/{n} median {med['pij']:.0f} vs {med['pi']:.0f} resolved {res['pij']} vs {res['pi']}")
