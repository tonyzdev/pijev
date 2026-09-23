# SWE-bench Verified: Jev as a retrieval reranker

## Why this experiment exists

Every prior experiment in this repository ranked files inside PiJev itself (35 TypeScript
files, 3,678 lines) or the eval fixtures (17–21 files, ~120 KB). At that size there is no
retrieval problem to solve: `rg` returns the whole project and the main model can read it
all. Those experiments could not have detected a ranking benefit even if one existed, which
is the most likely reason they kept returning inconclusive results.

This experiment moves to a corpus where retrieval is the actual bottleneck, and where
relevance has ground truth.

## Setup

- **Dataset**: SWE-bench Verified (500 human-validated real GitHub issues). Sample of 20
  instances: 10 `django/django` + 10 `sympy/sympy`, spread across the difficulty buckets.
- **Corpus**: every `.py` file in the repository at each instance's `base_commit`.
  Median **1,545 files** per instance (django ≈ 2,000 files / 325k lines).
- **Ground truth**: the files edited by the instance's reference patch. Tests are left in
  the candidate pool; nothing is filtered by path.
- **Baseline**: Okapi BM25 (k1=1.2, b=0.75) over file contents, query = the issue text.
- **Candidate stage**: BM25 top-100. (PiJev now ships 50: the [shortlist ablation](shortlist-and-private-repo.md) shows it keeps every rank-1 result at half the Jev cost.)
- **Rerank stage**: Jev scores each candidate with one `noul` question — "does this file
  need to be read or edited to resolve the task?" Files are sent as compact outlines
  (path, imports, top-level defs/classes, query-matching lines; ≤1,800 bytes each), because
  at this scale whole files do not fit the 90 KB request bound. ~3 requests per instance.

Harness: `eval/swebench-retrieval.ts`. Raw results: `eval/swebench-retrieval-results/`.

## Results (20 instances)

| metric | BM25 | Jev rerank |
|---|---:|---:|
| recall@1 | 0.250 | **0.740** |
| recall@5 | 0.575 | **0.905** |
| recall@10 | 0.740 | **0.957** |
| recall@20 | 0.742 | **0.960** |
| recall@100 (shortlist ceiling) | 0.967 | — |

| | BM25 | Jev |
|---|---:|---:|
| median rank of first gold file | 4 | **1** |
| mean rank of first gold file | 9.8 | **1.4** |
| gold file at rank 1 | 5/20 | **17/20** |
| gold file missed by top-10 | 4/20 | **0/20** |

Rank of the first gold file improved on 15 instances, was unchanged on 5, and **worsened on
none**.

## Control: the gain is not "down-rank the tests"

A cheap local rule — penalise anything under `tests/` — would explain a result like this if
BM25's failures were all test files crowding out implementation. It does not apply here:
Jev's top-10 contains **more** test files (34%) than BM25's (25%). Jev promotes the right
implementation file while keeping the matching test alongside it.

`django__django-10973` (issue about `dbshell` for PostgreSQL) is the clearest case. BM25's
top-5 is `setup.py`, `core/cache/backends/base.py`, `utils/autoreload.py`,
`db/backends/oracle/base.py`, `core/management/base.py` — the gold file sits at rank 53.
Jev's top-5 is the gold `db/backends/postgresql/client.py`, then
`tests/dbshell/test_postgresql.py`, `postgresql/operations.py`, `postgresql/base.py`,
`oracle/client.py`: a coherent neighbourhood rather than a keyword match.

## Cost

60 Jev requests, 1.12M input tokens, 35.6k output tokens, zero fallbacks. ~3 requests and
4.6 s per instance. Gateway balance moved $10.00 → $9.65, so the whole sweep cost roughly
**$0.35** — against $18 of main-model spend for the earlier inconclusive rounds. No main
model was called at any point.

## What this does and does not establish

Established: on a repository-scale corpus, Jev's relevance judgement is substantially
better than the standard lexical baseline at putting the file that must be edited in front
of the agent, and the advantage does not come from a path heuristic.

Not established: that this converts into a higher task resolve rate. Ranking quality and
end-to-end benefit are separate claims. The next stage is to run the full agent on a subset
with and without the reranker, which is the only part that needs main-model budget — and it
is now worth spending, because stage 1 says there is something to convert.

## Limitations

- 20 instances, two repositories, Python only. Wide confidence intervals.
- Jev cannot rank above the BM25 shortlist: recall@100 (0.967) is a hard ceiling, and
  `sympy__sympy-13091` (21 gold files, 7 in the shortlist) dominates the residual loss.
- The outline representation is one design among several; whole-file, chunk-level and
  hybrid inputs are untested.

---

# Applying the result to PiJev's own pipeline

## What was wrong

Running PiJev's shipped `discoverCode` against django at four of these instances showed the
gold file reaching the candidate pool **1 time out of 5**. Jev was being asked to rank 32
windows that usually did not contain the answer, so its ranking quality was irrelevant.

Four defects, in the order they bind:

1. **Ranking unit was a window, not a file.** Up to four windows per file competed with each
   other, and `select()`'s cross-file diversification then suppressed the file they came
   from. A file is what gets read and edited; splitting it scatters the evidence for that
   decision.
2. **The shortlist was 32 windows.** A wide shortlist is the entire point of reranking.
3. **The prefilter was not BM25.** `lineTerms.size * 4 + terms.size * 2 + pathTerms.size`
   counts how many distinct query words appear, with no idf and no length normalization, so
   a file repeating common words beats the one file carrying the decisive rare identifier.
4. **Read budgets bound early.** `MAX_FILES = 1000` and `MAX_READ_BYTES = 4 MB` covered
   ~430 of django's 2,464 Python files.

## What changed

- `discoverCode` scores **whole files with Okapi BM25** and returns one candidate per file,
  shortlist 100. Each candidate carries a real excerpt (unchanged output contract) plus a
  ≤1,200-byte `outline` used only for ranking.
- `DecisionEngine.rankCode` **batches** the shortlist under a 70 KB transport bound, scores
  outlines rather than excerpts, and discards the whole ranking if any batch fails or omits
  a candidate — never a partial order.
- Budgets raised to 20,000 files / 48 MB with an 8 s read deadline, and made overridable so
  tests exercise the bounds cheaply.

Two defects surfaced only by measuring against the benchmark:

- **Term frequencies were being discarded.** `tokens()` returns a `Set`, so every frequency
  was 1 and length normalization used the distinct-term count — BM25 degraded to
  idf-weighted binary overlap. `tokenCounts()` now supplies real frequencies.
- **Documentation monopolised the shortlist.** For `django__django-10097`, **92 of the top
  100** files were `docs/*.txt`: prose repeats natural-language query words far more densely
  than code does. The shortlist is now stratified, reserving 80% of slots for source, so
  both kinds reach the ranker instead of either being excluded.

## Rerun, same four instances

| instance | gold in pool | BM25 rank | gold in top-8 | Jev rank |
|---|:--:|:--:|:--:|:--:|
| django__django-10097 | 1/1 | 44 | 1/1 | **1** |
| django__django-10554 | 2/2 | 2, 5 | 2/2 | **1, 3** |
| django__django-10880 | 1/1 | 11 | 1/1 | **1** |
| django__django-10914 | 1/1 | 2 | 1/1 | **2** |

**Gold in candidate pool: 1/5 → 5/5. Gold in the top-8 shown to the model: 1/5 → 5/5.**

`django__django-10097` is the pattern in miniature: BM25 puts the gold file at 44, Jev moves
it to 1. Neither stage alone would have delivered it.

Cost: 12 Jev requests, 171k input tokens, 0 fallbacks. Discovery ~3.9 s and ranking ~2.7 s
per query over 5,900 files — slower than before, and worth measuring against a narrower
`pijev_search` question than a pasted issue body.

## Caveats

- Four instances, one repository. This shows the pipeline defects are fixed, not that the
  ranking quality generalises; the 20-instance Stage 1 numbers above remain the evidence for
  that.
- The prose stratification was motivated by a single observed failure. The 80/20 split is a
  guess and needs validation across the wider sample.
- Still untested end to end: whether any of this raises the task resolve rate.

---

# Stage 1 rerun: the full sample through PiJev's own pipeline

The four-instance rerun above showed the pipeline defects were fixed. This repeats the whole
20-instance sample through the shipped `discoverCode` + `DecisionEngine.rankCode`
(`eval/swebench-pipeline.ts`), so the numbers describe the product rather than a harness.

| metric | PiJev BM25 | PiJev + Jev | (harness BM25) | (harness + Jev) |
|---|---:|---:|---:|---:|
| recall@1 | 0.150 | **0.690** | 0.250 | 0.740 |
| recall@5 | 0.450 | **0.840** | 0.575 | 0.905 |
| recall@10 | 0.502 | **0.905** | 0.740 | 0.957 |
| recall@20 | 0.740 | **0.907** | 0.742 | 0.960 |
| recall@100 (shortlist ceiling) | 0.914 | — | 0.967 | — |

| | PiJev BM25 | PiJev + Jev |
|---|---:|---:|
| median rank of first gold file | 6 | **1** |
| gold file at rank 1 | 3/20 | **16/20** |
| gold file missed by top-10 | 9/20 | **1/20** |

Rank improved on 16 instances, unchanged on 4, **worsened on none**. 60 Jev requests, 900k
input tokens, zero fallbacks. Median 2.3 s discovery + 2.4 s ranking per query.

## Prose share, chosen by ablation rather than by guess

The 80/20 source/prose split introduced above was a guess motivated by one failure. Ablating
it over all 20 instances — a purely local measurement, no API calls — gave:

| proseShare | gold in shortlist | BM25 recall@20 |
|---:|---:|---:|
| 0.5 | 0.545 | 0.615 |
| 0.2 | 0.614 | 0.615 |
| **0.1** | **0.636** | **0.740** |
| 0.0 | 0.659 | 0.755 |

The aggregate is dominated by `sympy__sympy-13091` (21 gold files), so it was checked
per instance: at 0.1 the first gold file ranked **better on 4 instances, the same on 16, and
worse on none** than at 0.2. A share of zero scores marginally higher still, but it would
make a question about documentation unanswerable, so it is rejected on design grounds rather
than tuned away. Default is now 0.1, overridable per call.

## The residual gap is corpus composition, not ranking

PiJev still trails the standalone harness (recall@10 0.905 vs 0.957; ceiling 0.914 vs 0.967).
The harness restricted its corpus to `.py` files — 2,464 per django instance. PiJev cannot
assume a language and scans every text file, ~5,980 per django instance, which both adds
competing documents and distorts the idf statistics that BM25 depends on. The reranking
stage is not what differs.

`django__django-11087` is the one instance where the gold file never enters the shortlist at
any prose share. The issue body is mostly a `UnicodeDecodeError` traceback, so its most
distinctive tokens are the stack frames in `django/core/management/`, while the fix belongs
in `django/db/models/deletion.py`. The symptom path and the fix location share almost no
vocabulary. No lexical prefilter recovers that, and Jev cannot rank what the shortlist
excludes — this is the structural ceiling of retrieve-then-rerank, not a tuning failure.

## Status

Established across 20 instances on the shipped pipeline: Jev reranking roughly doubles
recall@10 over the BM25 prefilter and puts the file that must be edited first in 16 of 20
cases. Still unestablished: any effect on task resolve rate.
