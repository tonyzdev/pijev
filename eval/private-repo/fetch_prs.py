"""Candidate tasks from a private repository's merged PRs: base = first parent of the merge commit; the diff is split into
code, tests and docs; git submodule entries are dropped. Usage: fetch_prs.py [PR numbers...]"""
import json, subprocess, os, sys
import os, json as _json
def _local(key, default=None):
    v = os.environ.get(key)
    if v: return v
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".local.json")
    try: return _json.load(open(p)).get(key, default)
    except FileNotFoundError: return default
SC = os.environ.get("PIJ_SCRATCH", "/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad") + "/private-repo"
REPO = _local("PRIVATE_REPO")  # local checkout of the private repository (untracked config)
DEFAULT = [318, 314, 311, 309, 307, 305, 304, 293, 280, 279, 276, 274, 272, 271, 270, 269, 267, 262, 261, 260, 259, 258, 257, 302, 301, 294, 292, 290, 288]
NUMS = [int(x) for x in sys.argv[1:]] or DEFAULT
GENERATED = {"api/client/v1.d.ts", "src/lib/db/schema.generated.ts", "api/openapi.v1.json", "sql/schema.sql"}
import time
def sh(*a, **k):
    for attempt in range(3):   # gh's API calls fail transiently; an empty answer is retried, not parsed
        r = subprocess.run(a, capture_output=True, text=True, **k)
        if r.returncode == 0 and (a[0] != "gh" or r.stdout.strip()): return r.stdout
        time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{' '.join(a[:3])} failed: {r.stderr[-200:]}")
def is_test(p): return p.startswith("tests/") or ".test." in p or "/test/" in p
def is_doc(p): return p.endswith(".md") or p.startswith("docs/")
os.makedirs(SC, exist_ok=True)
prev = {p["pr"]: p for p in json.load(open(f"{SC}/prs.json"))} if os.path.exists(f"{SC}/prs.json") else {}
for n in NUMS:
    meta = json.loads(sh("gh", "pr", "view", str(n), "--json", "number,title,body,mergeCommit,mergedAt,closingIssuesReferences", cwd=REPO))
    merge = meta["mergeCommit"]["oid"]; base = sh("git", "-C", REPO, "rev-parse", f"{merge}^1").strip()
    submodules = {l.split()[3] for l in sh("git", "-C", REPO, "ls-tree", "-r", merge).split("\n") if l.startswith("160000")}
    files = [f for f in sh("git", "-C", REPO, "diff", "--name-only", base, merge).split() if f not in submodules]
    tests = [f for f in files if is_test(f)]; docs = [f for f in files if is_doc(f) and not is_test(f)]; code = [f for f in files if f not in tests and f not in docs]
    test_patch = sh("git", "-C", REPO, "diff", base, merge, "--", *tests) if tests else ""
    patch = sh("git", "-C", REPO, "diff", base, merge, "--", *[f for f in files if f not in tests]) if code or docs else ""
    issues = [json.loads(sh("gh", "issue", "view", str(i["number"]), "--json", "number,title,body", cwd=REPO)) for i in meta.get("closingIssuesReferences") or []]
    gold = [f for f in code if f.endswith((".ts", ".tsx", ".sql", ".mjs", ".js")) and f not in GENERATED]
    prev[n] = dict(pr=n, title=meta["title"], body=meta["body"], merged=meta["mergedAt"][:10], base=base, merge=merge, files=files, tests=[t for t in tests if t.endswith(".ts")], code=code, docs=docs, gold=gold, issues=issues, patch=patch, test_patch=test_patch, patch_lines=patch.count("\n"), test_lines=test_patch.count("\n"))
    json.dump(sorted(prev.values(), key=lambda p: -p["pr"]), open(f"{SC}/prs.json", "w"), ensure_ascii=False)
    print(f"#{n:<4} base={base[:10]} code={len(code):<3} gold={len(gold):<3} tests={len(tests):<2} patch={patch.count(chr(10)):<5} issues={[i['number'] for i in issues]} {meta['title'][:60]}", flush=True)
json.dump(sorted(prev.values(), key=lambda p: -p["pr"]), open(f"{SC}/prs.json", "w"), ensure_ascii=False)
