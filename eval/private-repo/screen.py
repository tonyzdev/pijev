"""Screen a private repository's PRs into SWE-bench-style instances with a `node --test` oracle.
For each PR: checkout base (git archive), install the merge commit's dependency tree offline from the local pnpm store (source stays at base), apply the
test patch and run the PR's test files (expect failures), then apply the code patch too (expect passes).
Keep PRs whose oracle discriminates in this environment. Usage: screen.py [PR numbers...] (given numbers run serially)"""
import json, os, re, subprocess, sys, time, shutil
import os, json as _json
def _local(key, default=None):
    v = os.environ.get(key)
    if v: return v
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".local.json")
    try: return _json.load(open(p)).get(key, default)
    except FileNotFoundError: return default
from concurrent.futures import ThreadPoolExecutor
SC = os.environ.get("PIJ_SCRATCH", "/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad") + "/private-repo"
REPO = _local("PRIVATE_REPO"); WORK = f"{SC}/work"
PRS = json.load(open(f"{SC}/prs.json")); os.makedirs(WORK, exist_ok=True)
ONLY = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else None
def sh(cmd, cwd=None, timeout=300, env=None, shell=False):
    try:
        r = subprocess.run(cmd, cwd=cwd, shell=shell, capture_output=True, text=True, timeout=timeout, env=env); return r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        d = lambda x: x.decode("utf-8", "replace") if isinstance(x, bytes) else (x or "")
        return 124, d(e.stdout) + d(e.stderr) + "\nTIMEOUT"
def install_cmd(repo, base, merge):
    """Dependencies from the merge commit (the environment the reference fix runs in, as SWE-bench builds it);
    source stays at base: changed manifests are swapped in for the install, then restored."""
    return (f'set -e; M=$(git -C "{repo}" diff --name-only {base} {merge} -- package.json "**/package.json" pnpm-lock.yaml pnpm-workspace.yaml); '
            f'for f in $M; do mkdir -p "$(dirname "$f")"; git -C "{repo}" show {merge}:"$f" > "$f" 2>/dev/null || rm -f "$f"; done; '
            'npx -y pnpm@11.5.2 install --frozen-lockfile --offline; git checkout -q -- .; git clean -qfd')
def parse_tap(tap, file):
    """Node's TAP: '# Subtest: name' opens a block; 'ok N - name' closes it at the same indent. Ids are file::a > b."""
    st = {}; names = []
    for line in tap.split("\n"):
        ind = (len(line) - len(line.lstrip(" "))) // 4; s = line.strip()
        m = re.match(r"# Subtest: (.*)", s)
        if m: names = names[:ind] + [m.group(1)]; continue
        m = re.match(r"(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO).*)?$", s)
        if m: st[file + "::" + " > ".join(names[:ind] + [m.group(2)])] = "skipped" if m.group(3) else ("ok" if m.group(1) == "ok" else "FAILED")
    return st
def run_tests(work, tests):
    env = {**os.environ, "HOME": f"{work}/.home", "TMPDIR": f"{work}/.tmp", "NODE_ENV": "test"}; status = {}; log = ""
    for t in tests:
        code, out = sh(["node", "--import", "tsx", "--test", "--test-reporter=tap", t], cwd=work, timeout=420, env=env)
        status.update(parse_tap(out, t)); log += f"\n### {t} exit={code}\n" + out[-1500:]
        if not any(k.startswith(t + "::") for k in status): status[t + "::<no tests parsed>"] = "ERROR"
    return status, log
def screen(p):
    n = p["pr"]; work = f"{WORK}/{n}"; t0 = time.time()
    rec = {"pr": n, "title": p["title"], "verdict": "UNUSABLE", "why": "", "tests": p["tests"]}
    try:
        shutil.rmtree(work, ignore_errors=True); os.makedirs(f"{work}/.home"); os.makedirs(f"{work}/.tmp")
        code, out = sh(f"git -C {REPO} archive {p['base']} | tar -x -C {work}", shell=True)
        if code: rec["why"] = "archive: " + out[-200:]; return rec
        sh(["git", "init", "-q"], cwd=work); open(f"{work}/.git/info/exclude", "w").write("node_modules\n.home/\n.tmp/\n")
        sh(["git", "-c", "user.name=e", "-c", "user.email=e@e", "add", "-A"], cwd=work); sh(["git", "-c", "user.name=e", "-c", "user.email=e@e", "commit", "-qm", "base"], cwd=work)
        code, out = sh(install_cmd(REPO, p["base"], p["merge"]), cwd=work, timeout=600, shell=True)
        if code: rec["why"] = "install: " + out[-300:]; return rec
        open(f"{work}.test.patch", "w").write(p["test_patch"]); open(f"{work}.gold.patch", "w").write(p["patch"])
        code, out = sh(["git", "apply", f"{work}.test.patch"], cwd=work)
        if code: rec["why"] = "test patch: " + out[-200:]; return rec
        tests = [t for t in p["tests"] if os.path.exists(f"{work}/{t}")]
        if not tests: rec["why"] = "no test files after patch"; return rec
        t1 = time.time(); neg, neglog = run_tests(work, tests)
        sh(["git", "checkout", "-q", "--", "."], cwd=work); sh(["git", "clean", "-qfd"], cwd=work)
        code, out = sh(["git", "apply", f"{work}.gold.patch", f"{work}.test.patch"], cwd=work)
        if code: rec["why"] = "gold patch: " + out[-200:]; return rec
        pos, poslog = run_tests(work, tests); rec["testSec"] = round(time.time() - t1)
        f2p = sorted(t for t, s in pos.items() if s == "ok" and neg.get(t) in ("FAILED", "ERROR", None))
        p2p = sorted(t for t, s in pos.items() if s == "ok" and neg.get(t) == "ok")
        broken = [t for t, s in pos.items() if s in ("FAILED", "ERROR")]
        rec.update(f2p=f2p, p2p=p2p, broken=broken[:10], negCounts={k: sum(1 for v in neg.values() if v == k) for k in set(neg.values())}, posCounts={k: sum(1 for v in pos.values() if v == k) for k in set(pos.values())}, tests=tests)
        open(f"{work}.log", "w").write("=== BEFORE GOLD ===\n" + neglog + "\n=== AFTER GOLD ===\n" + poslog)
        if not neg and not pos: rec["why"] = "no tests parsed"; return rec
        if f2p and not broken: rec["verdict"] = "DISCRIMINATES"
        elif not f2p: rec["why"] = "no test flips fail->pass"
        else: rec["why"] = f"{len(broken)} tests still failing with gold patch"
        return rec
    except Exception as e:
        rec["why"] = f"exception: {e}"; return rec
    finally:
        rec["sec"] = round(time.time() - t0)
        if os.path.isdir(f"{work}/.git"): sh(["git", "checkout", "-q", "--", "."], cwd=work); sh(["git", "clean", "-qfd"], cwd=work)
todo = [p for p in PRS if not ONLY or p["pr"] in ONLY]; results = []
with ThreadPoolExecutor(max_workers=1 if ONLY else 3) as ex:
    for rec in ex.map(screen, todo):
        results.append(rec)
        print(f"{rec['verdict']:<14} #{rec['pr']:<4} {rec.get('sec','-')}s tests={rec.get('testSec','-')}s f2p={len(rec.get('f2p',[]))} p2p={len(rec.get('p2p',[]))} broken={len(rec.get('broken',[]))} {rec['why'][:100]}", flush=True)
        json.dump(results, open(f"{SC}/screened{'-' + '-'.join(map(str, ONLY)) if ONLY else ''}.json", "w"), indent=1, ensure_ascii=False)
ok = [r for r in results if r["verdict"] == "DISCRIMINATES"]; print(f"\n{len(ok)}/{len(results)} discriminate")
