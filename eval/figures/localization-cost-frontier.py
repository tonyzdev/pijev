import json, math
SC="/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad"
import os
P=json.load(open(os.path.join(os.path.dirname(__file__), "..", "swebench-agent-results", "localization-cost-frontier.json")))
W,H=1672,800; PANEL,BORDER,GRID="#1e1e1e","#3a3a3a","#2e2e2e"; INK,INK2,INK3="#ededed","#b4b4b4","#8c8c8c"
COL={"pi":"#9a9a9a","off":"#3987e5","jev":"#d55181"}; FRONT="#9a9a9a"
SANS="'Helvetica Neue',Helvetica,Arial,'PingFang SC',sans-serif"
o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{SANS}">', f'<rect width="{W}" height="{H}" rx="6" fill="{PANEL}" stroke="{BORDER}" stroke-width="1.5"/>']
def t(x,y,s,fill=INK2,size=15,weight="400",anchor="start",halo=False):
    h=f' stroke="{PANEL}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round"' if halo else ""
    o.append(f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"{h}>{s}</text>')
def mark(x,y,col,shape,r=8):
    if shape=="d": o.append(f'<path d="M{x:.1f},{y-r:.1f} L{x+r:.1f},{y:.1f} L{x:.1f},{y+r:.1f} L{x-r:.1f},{y:.1f} Z" fill="{col}"/>')
    else: o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*0.9:.1f}" fill="{col}"/>')
wid=lambda s,size: sum((size*0.55 if ord(c)<128 else size) for c in s)
t(22,34,"定位命中率 vs 每任务成本 · 每个点是一个配置（越靠左上越好）· 纵轴是「首步就触达目标文件」的比例，不是任务完成率",INK,19,"600")
lx=22
for key,lab in (("pi","Pi（bash grep）"),("off","PiJev 无 Jev（BM25 briefing）"),("jev","PiJev + Jev")):
    o.append(f'<rect x="{lx}" y="55" width="12" height="12" rx="2" fill="{COL[key]}"/>'); t(lx+18,66,lab,INK2,15); lx+=18+wid(lab,15)+28
mark(lx+7,61,INK2,"c",7); t(lx+20,66,"主模型 v4-flash",INK2,15); lx+=20+wid("主模型 v4-flash",15)+28
mark(lx+7,61,INK2,"d",7); t(lx+20,66,"v4-pro",INK2,15); lx+=20+wid("v4-pro",15)+28
o.append(f'<line x1="{lx}" x2="{lx+26}" y1="61" y2="61" stroke="{FRONT}" stroke-width="1.6"/>'); t(lx+32,66,"frontier：没有既更省又定位更准的配置",INK2,15); lx+=32+wid("frontier：没有既更省又定位更准的配置",15)+28
o.append(f'<circle cx="{lx+6}" cy="61" r="6" fill="{PANEL}" stroke="{COL["jev"]}" stroke-width="1.8"/><line x1="{lx+12}" x2="{lx+38}" y1="61" y2="61" stroke="{COL["jev"]}" stroke-width="1.5" stroke-dasharray="3 3"/>'); t(lx+44,66,"空心 = 不含 Jev 时的成本，虚线 = Jev 的那部分",INK2,15)
XMIN,XMAX=0.002,0.05; YMIN,YMAX=-0.04,0.85
lg=math.log10
def sub(px0,pw,title,task):
    L,R,T,B=px0+64,22,112,92
    x=lambda v: L+(lg(v)-lg(XMIN))/(lg(XMAX)-lg(XMIN))*(px0+pw-R-L)
    y=lambda v: T+(YMAX-v)/(YMAX-YMIN)*(H-B-T)
    t(px0+22,100,title,INK,17,"600")
    for r in (0,0.2,0.4,0.6,0.8):
        o.append(f'<line x1="{L}" x2="{px0+pw-R}" y1="{y(r):.1f}" y2="{y(r):.1f}" stroke="{GRID}" stroke-width="1"/>'); t(L-10,y(r)+5,f"{int(r*100)}%",INK3,13,"400","end")
    for v in (0.002,0.005,0.01,0.02,0.05):
        o.append(f'<line x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{T}" y2="{H-B}" stroke="{GRID}" stroke-width="1"/>'); t(x(v),H-B+24,f"${v:g}",INK3,13,"400","middle")
    o.append(f'<line x1="{L}" x2="{px0+pw-R}" y1="{H-B}" y2="{H-B}" stroke="{BORDER}" stroke-width="1.5"/><line x1="{L}" x2="{L}" y1="{T}" y2="{H-B}" stroke="{BORDER}" stroke-width="1.5"/>')
    t(L+(px0+pw-R-L)/2,H-B+50,"每任务成本，美元（主模型 + Jev，对数）",INK2,14,"400","middle")
    o.append(f'<g transform="rotate(-90 {px0+24} {T+(H-B-T)/2:.1f})">'); t(px0+24,T+(H-B-T)/2,"首步触达目标文件的比例",INK2,14,"400","middle"); o.append("</g>")
    pts=[p for p in P if p["task"]==task]
    front=[p for p in pts if not any(q is not p and q["cost"]<=p["cost"] and q["rate"]>=p["rate"] and (q["cost"]<p["cost"] or q["rate"]>p["rate"]) for q in pts)]
    front.sort(key=lambda p:p["cost"])
    if len(front)>1: o.append('<polyline points="'+" ".join(f"{x(p['cost']):.1f},{y(p['rate']):.1f}" for p in front)+f'" fill="none" stroke="{FRONT}" stroke-width="1.6"/>')
    for p in pts:
        if p["jev"]>0:
            xm,xc,yy=x(p["main"]),x(p["cost"]),y(p["rate"])
            o.append(f'<line x1="{xm:.1f}" x2="{xc:.1f}" y1="{yy:.1f}" y2="{yy:.1f}" stroke="{COL["jev"]}" stroke-width="1.5" stroke-dasharray="3 3" stroke-opacity="0.8"/>')
            # hollow marker: where this configuration would sit on cost without Jev
            if p["model"]=="pro": o.append(f'<path d="M{xm:.1f},{yy-7:.1f} L{xm+7:.1f},{yy:.1f} L{xm:.1f},{yy+7:.1f} L{xm-7:.1f},{yy:.1f} Z" fill="{PANEL}" stroke="{COL["jev"]}" stroke-width="1.8"/>')
            else: o.append(f'<circle cx="{xm:.1f}" cy="{yy:.1f}" r="6.5" fill="{PANEL}" stroke="{COL["jev"]}" stroke-width="1.8"/>')
    for p in pts: mark(x(p["cost"]),y(p["rate"]),COL[p["family"]],"d" if p["model"]=="pro" else "c",9)
    # labels: right of the point, nudged apart when two share a row
    used=[]   # label bounding boxes already placed
    for p in sorted(pts,key=lambda p:(p["rate"],p["cost"])):
        s_=f"{p['label']}  {p['touch']}/{p['n']} · 解决 {p['resolved']}/{p['n']}"; w=wid(s_,13)
        right = x(p["cost"]) > px0+pw*0.66
        px=x(p["cost"])-14 if right else x(p["cost"])+14
        py=y(p["rate"])-10 if p["jev"]>0 else y(p["rate"])+5     # sit above the dashed Jev segment
        x0=px-w if right else px
        while any(x0<u[2] and u[0]<x0+w and abs(py-u[1])<17 for u in used): py-=17
        used.append((x0,py,x0+w)); t(px,py,s_,INK2,13,"400","end" if right else "start",halo=True)
    for p in pts: mark(x(p["cost"]),y(p["rate"]),COL[p["family"]],"d" if p["model"]=="pro" else "c",9)
sub(0,W/2,"SWE-bench Verified · django（模型熟悉，20 个实例）","django")
sub(W/2,W/2,"2025 年中后创建的仓库（陌生，13 个任务）","unfamiliar")
o.append(f'<line x1="{W/2:.0f}" x2="{W/2:.0f}" y1="84" y2="{H-20}" stroke="{BORDER}" stroke-width="1"/>')
t(22,H-14,"成本 = Pi 事件里主模型的目录价估算 + Jev 按网关实测 ≈$0.28 / 百万 token · 完成率在每个点的标签里 · 在 flash 这个价位，Jev 的每任务成本是主模型本身的 3–4 倍",INK3,12.5)
o.append("</svg>")
open(f"{SC}/fig/pareto.html","w").write('<style>*{margin:0;padding:0}html,body{background:#abbab9}body{padding:36px}</style>\n'+"\n".join(o)); print("written")
