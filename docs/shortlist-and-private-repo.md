# How many candidates Jev needs, and whether it holds on code no model has seen

Two retrieval-only questions, answered without a main model: every number here comes from PiJev's
shipped discovery (`discoverCode`) and ranking (`rankCode`) driven by `eval/swebench-pipeline.ts`. The
only spend is Jev.

1. The briefing asks Jev to score every file in a BM25 shortlist. In the agent experiments that
   shortlist was 100 files, which made Jev cost $0.011–0.014 per task — more than the DeepSeek main
   model. How small can it get before the file a developer has to edit stops coming out on top?
2. Every earlier task set is public code. Does Jev still rank the right file first on a private
   production codebase that no model can have memorized?

## Task sets

- **SWE-bench Verified**, the same 20 instances as the [retrieval experiment](swebench-retrieval-experiment.md)
  (10 django, 10 sympy): the issue text as the query, the files the reference patch edits as gold.
- **A private repository**: a production TypeScript monorepo (~115k lines, 1,100–1,450 files scanned
  per task), created after the main models' training cutoffs. 24 merged pull requests that edit
  source. Query: the PR's own description, cut before its verification and delivery sections, with
  every file path, commit SHA and link removed so the text cannot name the answer. Gold: the source
  files the PR edits (tests, docs and generated files excluded) — 1 to 29 per task. The descriptions
  are mostly Chinese with English identifiers, which also handicaps BM25's word matching; Jev reads
  either. The repository's identity, paths and PR text stay out of this repository: only the
  aggregate numbers below are committed (`eval/private-repo/` builds the tasks from an untracked
  local config).

Shortlist sizes 100, 50, 30 and 20 were each run on both sets — 176 rankings, every one applied (a
ranking that fell back to BM25 is retried and never counted as a Jev result; see *Gateway* below).
Summary: `eval/figures/shortlist-ablation.py` → `eval/swebench-pipeline-results/shortlist-ablation.json`.

## Results

"Rank 1" is the number of tasks where a file the change edits is the top-ranked file — the one the
briefing hands to the model whole.

| | shortlist | BM25 rank 1 | Jev rank 1 | Jev top 5 | Jev tokens / task | Jev $ / task |
|---|---:|---:|---:|---:|---:|---:|
| SWE-bench, 20 tasks | 100 | 3 | 15 | 19 | 46.3k | 0.0130 |
| | **50** | 3 | **16** | 18 | **23.5k** | **0.0066** |
| | 30 | 3 | 16 | 18 | 14.2k | 0.0040 |
| | 20 | 3 | 14 | 16 | 9.4k | 0.0026 |
| private repository, 24 tasks | 100 | 0 | 17 | 24 | 49.3k | 0.0138 |
| | **50** | 0 | **17** | 23 | **24.8k** | **0.0069** |
| | 30 | 0 | 14 | 22 | 15.1k | 0.0042 |
| | 20 | 0 | 14 | 20 | 10.4k | 0.0029 |

**On the private repository Jev ranks the first file to edit higher than BM25 on every one of the 24
tasks and lower on none** (exact sign test p = 1.2 × 10⁻⁷); the median rank of that file goes from 11
to 1. At a shortlist of 50: better on 23, equal on 1, worse on 0. On SWE-bench: better on 15 of 20,
worse on none (p = 6 × 10⁻⁵), median rank 6 → 1.

**Fifty candidates are enough.** Halving the shortlist keeps every rank-1 result of 100 on both sets
(16 vs 15 and 17 vs 17) and halves Jev's tokens; 30 is as good on SWE-bench but loses three of 24 on the
private repository, and 20 loses on both. PiJev's default is now 50 (`src/discovery.ts`). In the agent
runs the briefing was most of Jev's spend, so Jev per task falls from $0.011–0.014 to about
$0.007–0.008 — under half the deepseek-v4-pro main model's cost per task, still above v4-flash's. The
agent experiments themselves ran at 100; their effect on tool calls has not been re-measured at 50.

BM25's own top 5 depends on the shortlist size on the private repository (1 of 24 at 100, 17 at 20)
because the shortlist reserves a tenth of its places for prose and this repository's design notes and
delivery records match almost any query, landing above the code. Its rank-1 count does not change:
zero at every size.

## Gateway

On 2026-09-23 the Vercel AI Gateway refused a growing share of Jev requests as they approached the
70 KB batch bound PiJev used: about 1 in 4 at 40 KB, three in four at 50–60 KB, nearly all at 65 KB,
while small requests succeeded. `rankCode` sent its batches one after another and discarded the
ranking on any failure, so in real use a 100-file briefing silently became BM25's order. Batches are
now bounded at 32 KB and sent concurrently, and a batch refused with a 5xx is retried once; a second
failure still discards the whole ranking. Even so, under the gateway's behaviour that day the ranking
still fell back — and the evaluation harness had to rerun it — on 16 of 44 tasks at 100 files, 10 at 50
and 3 at 30: fewer candidates means fewer requests that can fail. If the gateway stays like this, 30
becomes the better default despite its three lost rank-1 results; the first thing to check before
changing it is whether the 503s persist. Ranking latency (median) is 1.3 s at 50.

## Limits

- Retrieval only. What a smaller shortlist and a private codebase do to the agent's tool calls and
  outcomes needs the agent runs, which need main-model budget.
- One run per configuration. The new 100-file run (32 KB concurrent batches) puts a gold file first
  on 15 of 20 SWE-bench tasks, the earlier run (70 KB sequential batches) on 16, so differences of one
  task between sizes are within noise.
- 24 private tasks from one repository and one team.
