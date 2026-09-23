"""Retrieval-only tasks from the private repository: every fetched PR that edits source, not only the
ones whose tests discriminate. Query = the same sanitized statement the agent tasks use; gold = the
source files the PR edits (generated files, docs and tests excluded). Writes an untracked sample for
eval/swebench-pipeline.ts to <scratch>/private-repo/retrieval-sample.json."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_instances import SC, SLUG, sanitize
prs = json.load(open(f"{SC}/prs.json"))
out = []
for p in prs:
    if not p["gold"]: continue
    if p["issues"]:
        i = p["issues"][0]; statement = f"{i['title']}\n\n{sanitize(i['body'])}"
    else:
        statement = f"{p['title']}\n\n{sanitize(p['body'])}"
    out.append({"repo": SLUG, "instance_id": f"{SLUG.replace('/', '__')}-{p['pr']}", "base_commit": p["base"], "problem_statement": statement, "gold": p["gold"], "patch_lines": p["patch_lines"]})
json.dump(out, open(f"{SC}/retrieval-sample.json", "w"), ensure_ascii=False)
print(f"{len(out)} retrieval tasks → {SC}/retrieval-sample.json; gold files per task: {sorted(len(o['gold']) for o in out)}")
