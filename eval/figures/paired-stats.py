"""Paired significance for the agent comparisons: per task, plain Pi vs PiJev + Jev (same model, budget, sandbox).
Exact two-sided sign tests on "fewer tool calls" and "reaches a gold file sooner", and a bootstrap 95% CI
(tasks resampled with replacement) for the total tool-call reduction. Reads execution-strips.json;
writes paired-stats.json next to it and prints a table."""
import json, math, os, random
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "swebench-agent-results")
D = json.load(open(os.path.join(HERE, "execution-strips.json")))
def sign_p(k, n):
    return 1.0 if n == 0 else min(1.0, 2 * sum(math.comb(n, i) for i in range(max(k, n - k), n + 1)) / 2 ** n)
def boot(pairs, B=20000, seed=1):
    rnd = random.Random(seed); v = []
    for _ in range(B):
        s = [rnd.choice(pairs) for _ in pairs]; v.append(1 - sum(b for _, b in s) / sum(a for a, _ in s))
    v.sort(); return v[int(.025 * B)], v[int(.975 * B)]
def first_gold(calls): return next((i + 1 for i, c in enumerate(calls) if c["gold"]), None)
out = {}; pooled = []
for name, S in D.items():
    T = S["tasks"]; pairs = [(len(t["pi"]["calls"]), len(t["pij"]["calls"])) for t in T]; pooled += pairs
    fewer = sum(b < a for a, b in pairs); more = sum(b > a for a, b in pairs)
    g = [(first_gold(t["pi"]["calls"]), first_gold(t["pij"]["calls"])) for t in T]
    sooner = sum(1 for a, b in g if a and b and b < a); later = sum(1 for a, b in g if a and b and b > a)
    lo, hi = boot(pairs)
    out[name] = dict(tasks=len(T), fewer=fewer, more=more, ties=len(T) - fewer - more, p_calls=sign_p(fewer, fewer + more),
                     reduction=1 - sum(b for _, b in pairs) / sum(a for a, _ in pairs), ci95=[lo, hi], gold_sooner=sooner, gold_later=later, p_gold=sign_p(sooner, sooner + later))
fewer = sum(b < a for a, b in pooled); more = sum(b > a for a, b in pooled); lo, hi = boot(pooled)
out["pooled"] = dict(tasks=len(pooled), fewer=fewer, more=more, ties=len(pooled) - fewer - more, p_calls=sign_p(fewer, fewer + more),
                     reduction=1 - sum(b for _, b in pooled) / sum(a for a, _ in pooled), ci95=[lo, hi])
json.dump(out, open(os.path.join(HERE, "paired-stats.json"), "w"), indent=1)
for k, v in out.items():
    print(f"{k:17} n={v['tasks']:<3} fewer {v['fewer']:>2} / more {v['more']:>2} p={v['p_calls']:.2g}  reduction {v['reduction']:.0%} (95% CI {v['ci95'][0]:.0%}…{v['ci95'][1]:.0%})"
          + (f"  gold sooner {v['gold_sooner']}/{v['gold_sooner'] + v['gold_later']} p={v['p_gold']:.2g}" if "gold_sooner" in v else ""))
