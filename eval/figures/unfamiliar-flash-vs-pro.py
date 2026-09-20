"""Flash and pro side by side: per-task paired arrows with a shared numbering, then grouped bars."""
import json, math, sys
SC = "/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad"
import os
D = json.load(open(os.path.join(os.path.dirname(__file__), "..", "swebench-agent-results", "unfamiliar-pro", "flash-vs-pro.json"))); NAME = sys.argv[1] if len(sys.argv) > 1 else "unfamiliar-both"; LANG = sys.argv[2] if len(sys.argv) > 2 else "zh"
S = {"zh": dict(title="同一批 13 个陌生仓库任务 · 每个任务从 Pi（灰）到 PiJev + Jev（洋红）的工具调用与上下文变化 · 左：DeepSeek v4-flash，右：v4-pro（越靠左下越省）",
        pi="Pi（bash grep）", arrow="箭头 Pi → PiJev，洋红 = 调用与上下文都更少，灰 = 只省其一或未省", ring="白圈 = 该 run 解决了任务", num="编号", numsub="= 任务，见下表",
        xaxis="进入主模型上下文的 prompt tokens（对数）", yaxis="工具调用次数", both="{both}/13 个任务两项都更省",
        metrics=[("首步即读到目标文件", "（越高越好）"), ("search 调用次数", "（越低越好）"), ("工具调用总数", "（越低越好）"), ("prompt tokens / 任务", "（越低越好）"), ("耗时 / 任务", "（越低越好）")],
        foot="柱 = 均值 · 白线 = 中位数 · 完成率：flash 两条 arm 各 {rf}/13，pro 各 {rp}/13 · 完成 = PR 测试补丁下 FAIL_TO_PASS 全过且无回归 · 预算 600k token / 40 轮 / 9 分钟 · 主模型 flash ${uf:.2f}、pro ${up:.2f} · Jev 平均每任务 flash +{jf:.1f}s、pro +{jp:.1f}s"),
     "en": dict(title="The same 13 unfamiliar-repository tasks · each task as an arrow from Pi (grey) to PiJev + Jev (magenta), tool calls against prompt tokens · left: DeepSeek v4-flash, right: v4-pro",
        pi="Pi (bash grep)", arrow="arrow Pi → PiJev; magenta = fewer calls and fewer tokens, grey = only one or neither", ring="white ring = run resolved the task", num="number", numsub="= task, see the table below",
        xaxis="prompt tokens entering the main model's context (log scale)", yaxis="tool calls", both="{both}/13 tasks cheaper on both axes",
        metrics=[("gold file on call 1", "(higher is better)"), ("search calls", "(lower is better)"), ("tool calls", "(lower is better)"), ("prompt tokens / task", "(lower is better)"), ("wall time / task", "(lower is better)")],
        foot="bar = mean · white line = median · resolved: flash {rf}/13 in both arms, pro {rp}/13 · resolved = every FAIL_TO_PASS test passes under the PR's test patch with no regression · budget 600k tokens / 40 turns / 9 min · main model flash ${uf:.2f}, pro ${up:.2f} · Jev per task flash +{jf:.1f} s, pro +{jp:.1f} s")}[LANG]
TASKS = D["tasks"]; M = D["models"]
W = 1672
PANEL, BORDER, GRID = "#1e1e1e", "#3a3a3a", "#2e2e2e"; INK, INK2, INK3 = "#ededed", "#b4b4b4", "#8c8c8c"
PI, JEV, LAB = "#9a9a9a", "#d55181", "#f0a3c4"
SANS = "'Helvetica Neue',Helvetica,Arial,'PingFang SC',sans-serif"
o = []
def t(x, y, s, fill=INK2, size=15, weight="400", anchor="start", halo=False):
    h = f' stroke="{PANEL}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round"' if halo else ""
    o.append(f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"{h}>{s}</text>')
def panel(x, y, w, h): o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PANEL}" stroke="{BORDER}" stroke-width="1.5"/>')
def dot(x, y, r=7, op=0.7): o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{PI}" fill-opacity="{op}"/>')
def dia(x, y, r=9): o.append(f'<path d="M{x:.1f},{y-r:.1f} L{x+r:.1f},{y:.1f} L{x:.1f},{y+r:.1f} L{x-r:.1f},{y:.1f} Z" fill="{JEV}"/>')
def ring(x, y): o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="13" fill="none" stroke="#ededed" stroke-width="1.5"/>')
wid = lambda s, size: sum((size * 0.55 if ord(c) < 128 else size) for c in s)

# ---- header: title + legend ----
HH = 92; panel(0, 0, W, HH)
t(22, 34, S["title"], INK, 19, "600")
lx = 22; dot(lx + 7, 66, 7, 0.7); t(lx + 22, 71, S["pi"], INK2, 15); lx += 22 + wid(S["pi"], 15) + 30
dia(lx + 7, 66, 7); t(lx + 22, 71, "PiJev + Jev", INK2, 15); lx += 22 + wid("PiJev + Jev", 15) + 30
o.append(f'<line x1="{lx}" x2="{lx+26}" y1="66" y2="66" stroke="{JEV}" stroke-width="2"/>'); lab = S["arrow"]; t(lx + 32, 71, lab, INK2, 15); lx += 32 + wid(lab, 15) + 30
ring(lx + 7, 66); t(lx + 24, 71, S["ring"], INK2, 15); lx += 24 + wid(S["ring"], 15) + 30
t(lx, 71, S["num"], LAB, 15, "600"); t(lx + wid(S["num"], 15) + (4 if LANG == "zh" else 12), 71, S["numsub"], INK2, 15)

# ---- two paired panels ----
PY0 = HH + 14; PH = 600; PW = (W - 14) / 2
XMIN, XMAX = 10_000, 700_000; YMIN, YMAX = 0, 46
lg = math.log10
def hero(px0, label, model):
    panel(px0, PY0, PW, PH)
    L, R, T, B = px0 + 60, 22, PY0 + 54, 60
    x = lambda v: L + (lg(max(v, XMIN)) - lg(XMIN)) / (lg(XMAX) - lg(XMIN)) * (px0 + PW - R - L)
    y = lambda v: T + (YMAX - v) / (YMAX - YMIN) * (PY0 + PH - B - T)
    t(px0 + 20, PY0 + 32, label, INK, 18, "600")
    for r in (10, 20, 30, 40):
        o.append(f'<line x1="{L}" x2="{px0+PW-R}" y1="{y(r):.1f}" y2="{y(r):.1f}" stroke="{GRID}" stroke-width="1"/>'); t(L - 10, y(r) + 5, str(r), INK3, 13, "400", "end")
    for v in (10_000, 30_000, 100_000, 300_000, 600_000):
        o.append(f'<line x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{T}" y2="{PY0+PH-B}" stroke="{GRID}" stroke-width="1"/>'); t(x(v), PY0 + PH - B + 22, f"{v//1000}k", INK3, 13, "400", "middle")
    o.append(f'<line x1="{L}" x2="{px0+PW-R}" y1="{PY0+PH-B}" y2="{PY0+PH-B}" stroke="{BORDER}" stroke-width="1.5"/><line x1="{L}" x2="{L}" y1="{T}" y2="{PY0+PH-B}" stroke="{BORDER}" stroke-width="1.5"/>')
    t(L + (px0 + PW - R - L) / 2, PY0 + PH - B + 46, S["xaxis"], INK2, 14, "400", "middle")
    o.append(f'<g transform="rotate(-90 {px0+22} {T+(PY0+PH-B-T)/2:.1f})">'); t(px0 + 22, T + (PY0 + PH - B - T) / 2, S["yaxis"], INK2, 14, "400", "middle"); o.append("</g>")
    per = M[model]["per"]; both = 0; boxes = []
    pts = []
    for tk in TASKS:
        a, b = per[tk["id"]]["pi"], per[tk["id"]]["pij"]
        x0, y0, x1, y1 = x(a["tokens"]), y(a["tools"]), x(b["tokens"]), y(b["tools"])
        ok = b["tools"] <= a["tools"] and b["tokens"] <= a["tokens"]; both += ok
        col = JEV if ok else "#8c8c8c"
        dx, dy = x1 - x0, y1 - y0; dist = math.hypot(dx, dy)
        if dist > 30:
            ux, uy = dx / dist, dy / dist; sx, sy = x0 + ux * 13, y0 + uy * 13; ex, ey = x1 - ux * 15, y1 - uy * 15
            o.append(f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex-ux*9:.1f}" y2="{ey-uy*9:.1f}" stroke="{col}" stroke-width="2" stroke-opacity="0.75"/>')
            bx, by = ex - ux * 10, ey - uy * 10
            o.append(f'<path d="M{ex:.1f},{ey:.1f} L{bx-uy*5:.1f},{by+ux*5:.1f} L{bx+uy*5:.1f},{by-ux*5:.1f} Z" fill="{col}" fill-opacity="0.9"/>')
        elif dist > 0:
            o.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="{col}" stroke-width="2" stroke-opacity="0.5"/>')
        pts.append((tk, a, b, x0, y0, x1, y1))
    for tk, a, b, x0, y0, x1, y1 in pts:
        dot(x0, y0); dia(x1, y1)
        if a["resolved"]: ring(x0, y0)
        if b["resolved"]: ring(x1, y1)
        boxes += [(x0 - 15, y0 - 15, x0 + 15, y0 + 15), (x1 - 15, y1 - 15, x1 + 15, y1 + 15)]
    hit = lambda p, q: p[0] < q[2] and q[0] < p[2] and p[1] < q[3] and q[1] < p[3]
    SLOTS = [(16, 5, "start"), (-16, 5, "end"), (0, -18, "middle"), (0, 24, "middle"), (16, -12, "start"), (16, 20, "start"), (-16, -12, "end"), (-16, 20, "end")]
    TIERS = [SLOTS] + [[(dx * k, dy * k, an) for dx, dy, an in SLOTS] for k in (2.2, 3.4, 4.8)]
    for tk, a, b, x0, y0, x1, y1 in sorted(pts, key=lambda p: (p[5], p[6])):
        s = str(tk["n"]); w = wid(s, 14) + 2; placed = False
        for ti, slots in enumerate(TIERS):
            for dx, dy, an in slots:
                xx = x1 + dx if an == "start" else x1 + dx - w if an == "end" else x1 + dx - w / 2
                bb = (xx - 3, y1 + dy - 12, xx + w + 3, y1 + dy + 4)
                if bb[0] < L or bb[2] > px0 + PW - R or bb[1] < T or bb[3] > PY0 + PH - B: continue
                if any(hit(bb, q) for q in boxes): continue
                if ti > 0:
                    ex = bb[0] if x1 < bb[0] else bb[2] if x1 > bb[2] else x1; ey = bb[1] if y1 < bb[1] else bb[3] if y1 > bb[3] else y1
                    o.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="{LAB}" stroke-width="1" stroke-opacity="0.8"/>')
                t(x1 + dx, y1 + dy, s, LAB, 14, "700", an, halo=True); boxes.append(bb); placed = True; break
            if placed: break
    t(px0 + PW - R, PY0 + 32, S["both"].format(both=both), INK, 16, "600", "end")
hero(0, "DeepSeek v4-flash", "flash"); hero(PW + 14, "DeepSeek v4-pro", "pro")

# ---- numbered task legend ----
LY = PY0 + PH + 14; LH = 92; panel(0, LY, W, LH)
cols = 7; cw = (W - 44) / cols
for i, tk in enumerate(TASKS):
    cx = 22 + (i % cols) * cw; cy = LY + 34 + (i // cols) * 34
    t(cx, cy, f"{tk['n']:>2}", LAB, 14, "700"); t(cx + 26, cy, tk["name"], INK2, 14)

# ---- grouped bars: flash vs pro ----
BY = LY + LH + 14; BH = 300; gap = 14; n = 5; bw = (W - gap * (n - 1)) / n
metrics = [(*S["metrics"][0], "firstgold", lambda v: f"{v}/13", 13),
           (*S["metrics"][1], "search", lambda v: f"{v:.1f}", None),
           (*S["metrics"][2], "tools", lambda v: f"{v:.1f}", None),
           (*S["metrics"][3], "tokens", lambda v: f"{v/1000:.0f}k", None),
           (*S["metrics"][4], "seconds", lambda v: f"{v:.0f}s", None)]
for i, (title, sub, key, fmt, ymax) in enumerate(metrics):
    px = i * (bw + gap); panel(px, BY, bw, BH)
    t(px + 18, BY + 30, title, INK, 16, "600"); t(px + 18 + wid(title, 16) + 6, BY + 30, sub, INK3, 13)
    vals = []
    for model in ("flash", "pro"):
        for arm in ("pi", "pij"):
            s = M[model][arm]; v = s[key] if key == "firstgold" else s[key]["mean"]; m = None if key == "firstgold" else s[key]["median"]
            vals.append((model, arm, v, m))
    top = ymax or max(v for _, _, v, _ in vals) * 1.3
    ax0 = px + 26; ax1 = px + bw - 16; base = BY + BH - 62; ceil = BY + 72
    yy = lambda v: base - (v / top) * (base - ceil)
    o.append(f'<line x1="{ax0}" x2="{ax1}" y1="{base}" y2="{base}" stroke="{BORDER}" stroke-width="1.5"/>')
    for g in (0.25, 0.5, 0.75, 1.0):
        if ymax or g < 1.0: o.append(f'<line x1="{ax0}" x2="{ax1}" y1="{yy(top*g):.1f}" y2="{yy(top*g):.1f}" stroke="{GRID}" stroke-width="1"/>')
    gw = (ax1 - ax0) / 2; barw = 16
    for j, (model, arm, v, m) in enumerate(vals):
        g = j // 2; k = j % 2; cx = ax0 + gw * g + gw * (0.33 + 0.34 * k)
        col = PI if arm == "pi" else JEV
        o.append(f'<rect x="{cx-barw/2:.1f}" y="{yy(v):.1f}" width="{barw}" height="{base-yy(v):.1f}" rx="2" fill="{col}"/>')
        top_y = min(yy(v), yy(m) if m is not None else yy(v)); t(cx, top_y - 8, fmt(v), INK, 12.5, "500", "middle")
        if m is not None: o.append(f'<line x1="{cx-barw/2-5:.1f}" x2="{cx+barw/2+5:.1f}" y1="{yy(m):.1f}" y2="{yy(m):.1f}" stroke="#ffffff" stroke-width="2"/>')
        t(cx, base + 18, "Pi" if arm == "pi" else "PiJev", col, 12, "500", "middle")
    for g, model in enumerate(("flash", "pro")):
        t(ax0 + gw * g + gw / 2, base + 38, f"v4-{model}", INK3, 12, "400", "middle")
H = BY + BH + 40
t(18, H - 12, S["foot"].format(rf=M['flash']['pi']['resolved'], rp=M['pro']['pi']['resolved'], uf=M['flash']['pi']['usd']+M['flash']['pij']['usd'], up=M['pro']['pi']['usd']+M['pro']['pij']['usd'], jf=M['flash']['pij']['jev_s'], jp=M['pro']['pij']['jev_s']), INK3, 12.5)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{SANS}">' + "\n".join(o) + "</svg>"
open(f"{SC}/fig/{NAME}.html", "w").write('<style>*{margin:0;padding:0}html,body{background:#abbab9}body{padding:36px}</style>\n' + svg)
print("written", W, H)
