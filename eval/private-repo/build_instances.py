"""Screened PRs of the private repository → instances for eval/swebench-agent.ts (runner node-test), written to eval/private-repo/instances.json.
problem_statement: the linked issue when there is one; otherwise the PR title and body cut before its verification /
delivery sections, with code blocks, file paths, commit SHAs and links removed so the fix's location is not handed over."""
import json, re, os, glob
import os, json as _json
def _local(key, default=None):
    v = os.environ.get(key)
    if v: return v
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".local.json")
    try: return _json.load(open(p)).get(key, default)
    except FileNotFoundError: return default
SLUG = _local("PRIVATE_REPO_SLUG")  # owner/name of the private repository (untracked config)
SC = os.environ.get("PIJ_SCRATCH", "/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad") + "/private-repo"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instances.json")
prs = {p["pr"]: p for p in json.load(open(f"{SC}/prs.json"))}
seen = {}
for f in sorted(glob.glob(f"{SC}/screened*.json")):
    for r in json.load(open(f)):
        if r["verdict"] == "DISCRIMINATES" or r["pr"] not in seen: seen[r["pr"]] = r
screened = sorted((r for r in seen.values() if r["verdict"] == "DISCRIMINATES"), key=lambda r: -r["pr"])
CUT = re.compile(r"^(?:#{1,6}\s*|\*\*)?(?:验证|校验|交付|测试|Verification|Validation|Testing|Delivery|Checks?)(?:记录|与|和|及|[:：\s*]|$).*$", re.M)
EXT = r"(?:json|jsonc|tsx|ts|mjs|cjs|js|sql|md|yaml|yml|sh|py)"
def sanitize(text):
    text = text or ""
    m = CUT.search(text); text = text[:m.start()] if m else text
    text = re.sub(r"```.*?```", "[code omitted]", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"\[([^\]]*)\]\((?:https?://|[\w./-]*/)[^)]*\)", "[link]", text)
    text = re.sub(r"https?://\S+", "[link]", text)
    text = re.sub(r"\b[0-9a-f]{7,40}\b", "[sha]", text)
    text = re.sub(r"`?(?:\.?[\w.*-]+/)+[\w.*-]+\." + EXT + r"\b`?", "[file]", text)
    text = re.sub(r"`[\w.-]+\." + EXT + r"`", "[file]", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
out = []
for r in screened:
    p = prs[r["pr"]]
    if p["issues"]:
        i = p["issues"][0]; statement = f"{i['title']}\n\n{sanitize(i['body'])}"; source = f"issue #{i['number']}"
    else:
        statement = f"{p['title']}\n\n{sanitize(p['body'])}"; source = "pr body (cut before verification, paths removed)"
    if len(statement) < 60: continue
    out.append({"repo": SLUG, "instance_id": f"{SLUG.replace('/', '__')}-{r['pr']}", "base_commit": p["base"], "problem_statement": statement, "statement_source": source,
        "patch": p["patch"], "test_patch": p["test_patch"], "FAIL_TO_PASS": json.dumps(r["f2p"]), "PASS_TO_PASS": json.dumps(r["p2p"]), "difficulty": "unscreened",
        "runner": "node-test", "repo_dir": SLUG.split("/")[1], "install": "npx -y pnpm@11.5.2 install --frozen-lockfile --offline", "test_files": r["tests"], "gold_files": p["gold"],
        "merged": p["merged"], "title": p["title"], "patch_lines": p["patch_lines"]})
json.dump(out, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"{len(out)} instances → {OUT}")
for i in out: print(f"  {i['instance_id']:<28} {i['statement_source']:<22} stmt={len(i['problem_statement']):<5} f2p={len(json.loads(i['FAIL_TO_PASS'])):<3} p2p={len(json.loads(i['PASS_TO_PASS'])):<3} gold={len(i['gold_files'])} patch={i['patch_lines']}")
