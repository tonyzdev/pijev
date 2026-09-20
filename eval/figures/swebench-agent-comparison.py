import json, math
SC="/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad"
import sys
DATA=sys.argv[1] if len(sys.argv)>1 else f"{SC}/agent-chart-data.json"
NAME=sys.argv[2] if len(sys.argv)>2 else "agent"
D=json.load(open(DATA))
META=D.pop("_meta",{})
ARMS=[("pi","Pi（bash grep）","#9a9a9a","c"),("pij-off","PiJev · 无 Jev（BM25 briefing）","#3987e5","c"),("pij-jev","PiJev · Jev 重排 briefing","#d55181","d")]
FIRST_GOLD={k:D[k].get("first_gold",0) for k in ("pi","pij-off","pij-jev")}
ARMS=[a for a in ARMS if D[a[0]].get("n",0)>0]
W,H=1672,1110
PANEL,BORDER,GRID="#1e1e1e","#3a3a3a","#2e2e2e"; INK,INK2,INK3="#ededed","#b4b4b4","#8c8c8c"; FRONT="#9a9a9a"
SANS="'Helvetica Neue',Helvetica,Arial,'PingFang SC',sans-serif"
o=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="{SANS}">']
def t(x,y,s,fill=INK2,size=15,weight="400",anchor="start",halo=False):
    h=f' stroke="{PANEL}" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round"' if halo else ""
    o.append(f'<text x="{x:.1f}" y="{y:.1f}" fill="{fill}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"{h}>{s}</text>')
def mark(x,y,col,shape,r=8):
    if shape=="d": o.append(f'<path d="M{x:.1f},{y-r:.1f} L{x+r:.1f},{y:.1f} L{x:.1f},{y+r:.1f} L{x-r:.1f},{y:.1f} Z" fill="{col}"/>')
    else: o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r*0.88:.1f}" fill="{col}"/>')
def panel(x,y,w,h): o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PANEL}" stroke="{BORDER}" stroke-width="1.5"/>')

# ---------- top: resolve rate vs context (log), their scatter ----------
PX,PY,PW,PH=0,0,W,760
panel(PX,PY,PW,PH)
t(22,34,META.get("title","SWE-bench Verified 20 个 django 实例 · 同一主模型 DeepSeek v4-flash：完成率 vs 每任务进入上下文的 token（越靠左上越好）"),INK,19,"600")
if META.get("hero")!="paired":
    lx=22
    for key,label,col,shape in ARMS:
        mark(lx+7,61,col,shape,7); t(lx+22,66,label,INK2,15)
        lx+=22+sum(15 if ord(c)>0x2E80 else 8.2 for c in label)+34
    o.append(f'<line x1="{lx}" x2="{lx+26}" y1="61" y2="61" stroke="{FRONT}" stroke-width="1.6"/>'); t(lx+32,66,"frontier：没有既更省又更准的配置",INK2,15)
if META.get("hero")=="paired":
    # legend override: ends of the pair plus a note on what a line means
    L,R,T,B=90,60,110,70
    XMIN,XMAX=META.get("pxmin",10_000),META.get("pxmax",700_000); YMIN,YMAX=0,46
    lg=math.log10
    x=lambda v: L+(lg(max(v,XMIN))-lg(XMIN))/(lg(XMAX)-lg(XMIN))*(PW-L-R)
    y=lambda v: T+(YMAX-v)/(YMAX-YMIN)*(PH-T-B)
    for r in (10,20,30,40):
        o.append(f'<line x1="{L}" x2="{PW-R}" y1="{y(r):.1f}" y2="{y(r):.1f}" stroke="{GRID}" stroke-width="1"/>'); t(L-12,y(r)+5,str(r),INK3,14,"400","end")
    for v in META.get("pxticks",(10_000,30_000,100_000,300_000,600_000)):
        o.append(f'<line x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{T}" y2="{PH-B}" stroke="{GRID}" stroke-width="1"/>'); t(x(v),PH-B+26,f"{v//1000}k",INK3,14,"400","middle")
    o.append(f'<line x1="{L}" x2="{PW-R}" y1="{PH-B}" y2="{PH-B}" stroke="{BORDER}" stroke-width="1.5"/><line x1="{L}" x2="{L}" y1="{T}" y2="{PH-B}" stroke="{BORDER}" stroke-width="1.5"/>')
    t(L+(PW-L-R)/2,PH-B+54,"该任务进入主模型上下文的 prompt tokens（对数）",INK2,15,"400","middle")
    o.append(f'<g transform="rotate(-90 40 {T+(PH-T-B)/2:.1f})">'); t(40,T+(PH-T-B)/2,"该任务的工具调用次数",INK2,15,"400","middle"); o.append('</g>')
    A=D["pi"]["per_instance"]; Bp={p["id"]:p for p in D["pij-jev"]["per_instance"]}
    better=0
    for pa in A:
        pb=Bp[pa["id"]]; x0,y0=x(pa["tokens"]),y(pa["tools"]); x1,y1=x(pb["tokens"]),y(pb["tools"])
        both=pb["tools"]<=pa["tools"] and pb["tokens"]<=pa["tokens"]; better+=both
        col="#d55181" if both else "#8c8c8c"
        # The segment stops short of both markers so the arrowhead sits outside the diamond.
        import math as _m
        dx,dy=x1-x0,y1-y0; dist=_m.hypot(dx,dy)
        if dist>30:
            ux,uy=dx/dist,dy/dist
            sx,sy=x0+ux*13,y0+uy*13              # leave the Pi circle
            ex,ey=x1-ux*15,y1-uy*15              # stop before the PiJev diamond
            o.append(f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex-ux*9:.1f}" y2="{ey-uy*9:.1f}" stroke="{col}" stroke-width="2" stroke-opacity="0.75"/>')
            bx,by=ex-ux*10,ey-uy*10
            o.append(f'<path d="M{ex:.1f},{ey:.1f} L{bx-uy*5:.1f},{by+ux*5:.1f} L{bx+uy*5:.1f},{by-ux*5:.1f} Z" fill="{col}" fill-opacity="0.9"/>')
        elif dist>0:
            o.append(f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" stroke="{col}" stroke-width="2" stroke-opacity="0.5"/>')
    # Marks first, then labels placed to avoid every mark, ring and earlier label.
    boxes=[]
    for pa in A:
        pb=Bp[pa["id"]]
        for pp,xx,yy,col,shape in ((pa,x(pa["tokens"]),y(pa["tools"]),"#9a9a9a","c"),(pb,x(pb["tokens"]),y(pb["tools"]),"#d55181","d")):
            if shape=="c": o.append(f'<circle cx="{xx:.1f}" cy="{yy:.1f}" r="7" fill="{col}" fill-opacity="0.7"/>')
            else: mark(xx,yy,col,shape,9)
            if pp["resolved"]: o.append(f'<circle cx="{xx:.1f}" cy="{yy:.1f}" r="13" fill="none" stroke="#ededed" stroke-width="1.5"/>')
            boxes.append((xx-15,yy-15,xx+15,yy+15))
    hit=lambda a,b: a[0]<b[2] and b[0]<a[2] and a[1]<b[3] and b[1]<a[3]
    SLOTS=[(18,5,"start"),(-18,5,"end"),(0,-20,"middle"),(0,26,"middle"),(18,-14,"start"),(18,22,"start"),(-18,-14,"end"),(-18,22,"end")]
    FAR=[(dx*2.6,dy*2.2,an) for dx,dy,an in SLOTS]+[(dx*4.2,dy*3.4,an) for dx,dy,an in SLOTS]+[(dx*6,dy*4.6,an) for dx,dy,an in SLOTS]
    for pa in sorted(A,key=lambda q:(x(Bp[q["id"]]["tokens"]),y(Bp[q["id"]]["tools"]))):
        pb=Bp[pa["id"]]; px,py=x(pb["tokens"]),y(pb["tools"]); label=pb["name"]
        w=sum(7.5 if ord(c)<128 else 12.5 for c in label)
        placed=False
        for far,slots in ((False,SLOTS),(True,FAR)):
            for dx,dy,an in slots:
                x0 = px+dx if an=="start" else px+dx-w if an=="end" else px+dx-w/2
                bb=(x0-3,py+dy-12,x0+w+3,py+dy+4)
                if bb[0]<L or bb[2]>PW-R or bb[1]<T or bb[3]>PH-B: continue
                if any(hit(bb,b) for b in boxes): continue
                if far:
                    ex = bb[0] if px<bb[0] else bb[2] if px>bb[2] else px
                    ey = bb[1] if py<bb[1] else bb[3] if py>bb[3] else py
                    o.append(f'<line x1="{px:.1f}" y1="{py:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#e07aa8" stroke-width="1" stroke-opacity="0.8"/>')
                t(px+dx,py+dy,label,"#f0a3c4",12.5,"500",an,halo=True); boxes.append(bb); placed=True; break
            if placed: break
    # legend, top-left under the title
    lx=22
    mark(lx+7,61,"#9a9a9a","c",7); t(lx+22,66,"Pi（bash grep）",INK2,15); lx+=22+15*9+34
    mark(lx+7,61,"#d55181","d",7); t(lx+22,66,"PiJev + Jev",INK2,15); lx+=22+8.2*9+34
    lab="箭头：同一任务 Pi → PiJev，洋红 = 调用与上下文都更少"
    o.append(f'<line x1="{lx}" x2="{lx+26}" y1="61" y2="61" stroke="#d55181" stroke-width="2"/>'); t(lx+32,66,lab,INK2,15); lx+=32+sum(15 if ord(c)>0x2E80 else 8.2 for c in lab)+34
    o.append(f'<circle cx="{lx+7}" cy="61" r="9" fill="none" stroke="#ededed" stroke-width="1.5"/>'); t(lx+24,66,"白圈 = 该 run 解决了任务",INK2,15); lx+=24+15*13+34
    t(lx,66,"任务名",'#f0a3c4',15,"500"); t(lx+15*3+4,66,"标在 PiJev 那端",INK2,15)
    t(PW-R,T+22,f"{better}/{len(A)} 个任务 PiJev 的调用与上下文同时更少",INK,17,"600","end",halo=True)
else:
    L,R,T,B=90,60,110,70
    XMIN,XMAX=META.get("xmin",100_000),META.get("xmax",400_000); YMIN,YMAX=META.get("ymin",0.55),META.get("ymax",0.90)
    lg=math.log10
    x=lambda v: L+(lg(v)-lg(XMIN))/(lg(XMAX)-lg(XMIN))*(PW-L-R)
    y=lambda v: T+(YMAX-v)/(YMAX-YMIN)*(PH-T-B)
    for r in META.get("yticks",(0.6,0.7,0.8,0.9)):
        o.append(f'<line x1="{L}" x2="{PW-R}" y1="{y(r):.1f}" y2="{y(r):.1f}" stroke="{GRID}" stroke-width="1"/>'); t(L-12,y(r)+5,f"{int(r*100)}%",INK3,14,"400","end")
    for v in META.get("xticks",(100_000,150_000,200_000,300_000,400_000)):
        o.append(f'<line x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{T}" y2="{PH-B}" stroke="{GRID}" stroke-width="1"/>'); t(x(v),PH-B+26,f"{v//1000}k",INK3,14,"400","middle")
    o.append(f'<line x1="{L}" x2="{PW-R}" y1="{PH-B}" y2="{PH-B}" stroke="{BORDER}" stroke-width="1.5"/><line x1="{L}" x2="{L}" y1="{T}" y2="{PH-B}" stroke="{BORDER}" stroke-width="1.5"/>')
    t(L+(PW-L-R)/2,PH-B+54,"每任务进入主模型上下文的 prompt tokens，均值（对数）",INK2,15,"400","middle")
    pts=[(k,D[k]["tokens"]["mean"],D[k]["resolved"]/D[k]["n"],col,shape,label) for k,label,col,shape in ARMS]
    front=[p for p in pts if not any(q is not p and q[1]<=p[1] and q[2]>=p[2] and (q[1]<p[1] or q[2]>p[2]) for q in pts)]
    front.sort(key=lambda p:p[1])
    if len(front)>1: o.append('<polyline points="'+" ".join(f"{x(p[1]):.1f},{y(p[2]):.1f}" for p in front)+f'" fill="none" stroke="{FRONT}" stroke-width="1.6"/>')
    # faint per-instance context spread per arm, as small ticks on a rug below the axis
    for k,label,col,shape in ARMS:
        for inst in D[k]["per_instance"]:
            v=max(XMIN,min(XMAX,inst["tokens"])); yy=PH-B-14 if k=="pi" else PH-B-9 if k=="pij-off" else PH-B-4
            o.append(f'<line x1="{x(v):.1f}" x2="{x(v):.1f}" y1="{yy}" y2="{yy+4}" stroke="{col}" stroke-width="2" stroke-opacity="0.55"/>')
    t(PW-R,PH-B-20,f"底部刻度：各 arm {D['pi']['n']} 个任务的逐任务 token（含超出 {XMAX//1000}k 者贴边）",INK3,12,"400","end")
    # Labels: leftmost point labelled to its left, rightmost to its right, any middle one below.
    order=sorted(pts,key=lambda p:p[1]); offsets={}
    for idx,pp in enumerate(order):
        offsets[pp[0]]=(-16,-14,"end") if idx==0 else (16,-14,"start") if idx==len(order)-1 else (0,30,"middle")
    for k,v,r,col,shape,label in pts:
        mark(x(v),y(r),col,shape,10)
        dx,dy,an=offsets[k]; d=D[k]
        t(x(v)+dx,y(r)+dy,f"{label.split('（')[0].split(' ·')[0] if k=='pi' else ('PiJev 无 Jev' if k=='pij-off' else 'PiJev + Jev')}  {d['resolved']}/{d['n']} · {v/1000:.0f}k tok · {d['seconds']['mean']:.0f}s",INK2,14,"400",an,halo=True)

# ---------- bottom: small bar panels, their "(lower is better)" style ----------
metrics=[("首步即读到目标文件","（越高越好）",lambda k:FIRST_GOLD[k],lambda k:None,lambda v:f"{v}/{D['pi']['n']}",D["pi"]["n"]),
         ("search 调用次数","（越低越好）",lambda k:D[k]["search"]["mean"],lambda k:D[k]["search"]["median"],lambda v:f"{v:.1f}",None),
         ("工具调用总数","（越低越好）",lambda k:D[k]["tools"]["mean"],lambda k:D[k]["tools"]["median"],lambda v:f"{v:.1f}",None),
         ("prompt tokens / 任务","（越低越好）",lambda k:D[k]["tokens"]["mean"]/1000,lambda k:D[k]["tokens"]["median"]/1000,lambda v:f"{v:.0f}k",None),
         ("耗时 / 任务","（越低越好）",lambda k:D[k]["seconds"]["mean"],lambda k:D[k]["seconds"]["median"],lambda v:f"{v:.0f}s",None)]
gap=14; n=len(metrics); bw=(W-gap*(n-1))/n; by0=PH+16; bh=H-by0-34
for i,(title,sub,fmean,fmed,fmt,ymax) in enumerate(metrics):
    px=i*(bw+gap); panel(px,by0,bw,bh)
    t(px+18,by0+30,title,INK,16,"600"); t(px+18+sum(15 if ord(c)>0x2E80 else 8.2 for c in title)+6,by0+30,sub,INK3,13)
    vals=[fmean(k) for k,_,_,_ in ARMS]; top=ymax or max(vals)*1.25
    ax0=px+30; ax1=px+bw-20; base=by0+bh-58; ceil=by0+70
    yy=lambda v: base-(v/top)*(base-ceil)
    o.append(f'<line x1="{ax0}" x2="{ax1}" y1="{base}" y2="{base}" stroke="{BORDER}" stroke-width="1.5"/>')
    for g in (0.25,0.5,0.75,1.0):
        if ymax or g<1.0: o.append(f'<line x1="{ax0}" x2="{ax1}" y1="{yy(top*g):.1f}" y2="{yy(top*g):.1f}" stroke="{GRID}" stroke-width="1"/>')
    slot=(ax1-ax0)/len(ARMS); barw=18
    for j,(k,label,col,shape) in enumerate(ARMS):
        cx=ax0+slot*(j+0.5); v=vals[j]; m=fmed(k)
        o.append(f'<rect x="{cx-barw/2:.1f}" y="{yy(v):.1f}" width="{barw}" height="{base-yy(v):.1f}" rx="2" fill="{col}"/>')
        top_y=min(yy(v), yy(m) if m is not None else yy(v))   # value label clears the median tick too
        t(cx,top_y-8,fmt(v),INK,13,"500","middle")
        if m is not None: o.append(f'<line x1="{cx-barw/2-6:.1f}" x2="{cx+barw/2+6:.1f}" y1="{yy(m):.1f}" y2="{yy(m):.1f}" stroke="#ffffff" stroke-width="2"/>')
        short={"pi":"Pi","pij-off":"PiJev 无 Jev","pij-jev":"PiJev + Jev"}[k]
        t(cx,base+20,short,col,12.5,"500","middle")
        if m is not None: t(cx,base+38,f"中位 {fmt(m)}",INK3,11.5,"400","middle")
t(18,H-12,META.get("footnote","柱 = 均值 · 白线 = 中位数 · 完成 = 参考测试补丁下 FAIL_TO_PASS 全过且无回归"),INK3,12.5)
o.append("</svg>")
open(f"{SC}/fig/{NAME}.html","w").write('<style>*{margin:0;padding:0}html,body{background:#abbab9}body{padding:36px}</style>\n'+"\n".join(o))
print("written")
