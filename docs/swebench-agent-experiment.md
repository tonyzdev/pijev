# End to end: Pi vs PiJev on SWE-bench Verified with one main model

Stage 1 (`docs/swebench-retrieval-experiment.md`) established that Jev reranking puts the file
that must be edited in front of the agent far more reliably than BM25. This experiment asks
the only question that matters after that: does it change what a coding agent actually does
and achieves on a real task?

![comparison](figures/swebench-agent-comparison.png)

*Figure: plain Pi against the current PiJev arms (no Jev: corrected prompt; Jev: calibrated-trust briefing, v3).*

## Setup

- **Instances**: 20 `django/django` instances from SWE-bench Verified. Candidates were
  pre-screened (`eval/swebench-agent-results/oracle-screen.txt`): in this environment the
  unfixed tree must fail at least one FAIL_TO_PASS test and the gold patch must pass all of
  them. 20 of 22 candidates passed; `django__django-10097` (broad FAIL_TO_PASS list that
  already passes here) and `django__django-11276` (needs docutils) were excluded.
- **Main model**: `deepseek-v4-flash` via Pi's built-in DeepSeek provider, thinking off,
  identical for every arm. Budget per run: 40 turns, 600k tokens, 9 minutes.
- **Arms**, all on the same prompt, workspace and sandbox:
  - **Pi** — plain `pi`, no extension. Searching means bash `grep`/`rg`/`find`.
  - **PiJev, no Jev** — `pijev --jev-mode off` with `PIJEV_SOURCE_BRIEFING=1`: the BM25
    shortlist from `discoverCode` is injected as an initial briefing and `pijev_search`
    returns BM25 order. No Jev requests.
  - **PiJev + Jev** — `pijev --jev-mode assist` with the briefing: the same shortlist, reranked
    by Jev before injection; `pijev_search` also reranked.
- **Oracle**: the reference test patch is applied on top of the agent's change and the
  modules named by FAIL_TO_PASS and PASS_TO_PASS are run (Python 3.8, editable install).
  *Resolved* = every FAIL_TO_PASS test passes and no PASS_TO_PASS test regresses.
- **Effort**: every tool call is classified by what it does (`classify()` in
  `eval/swebench-agent.ts`): `pijev_search` and bash `grep|rg|find|ls…` are *search*; `read`
  and bash `cat|head|sed -n…` are *read*; `runtests.py|pytest` is *test*.

Harness: `eval/swebench-agent.ts`. Raw per-run records, patches and summary:
`eval/swebench-agent-results/` (first pass), `v2/` (corrected prompt), `v3/` (calibrated
trust) and `v4/` (whole top file). 140 runs, 0 harness errors, about $0.45 of main-model spend in total.

## A confound, caught and corrected

The first pass of this experiment showed `pijev_search` being called twice in forty PiJev runs,
and this report initially attributed that to the model's habits. That attribution was wrong.
Capturing the system prompt from the actual provider request showed what the model was told:

```
Available tools:
- bash: Execute bash commands (ls, grep, find, etc.)        ← listed second
- pijev_search: Find and rank source excerpts ...              ← listed last
Guidelines:
- Use bash for file operations like ls, rg, find             ← the first guideline
- ...
- When locating unfamiliar behavior, ask pijev_search ...      ← ninth, conditional, hedged
```

Pi's default prompt instructs the model to search with `rg` through bash before it ever
reaches the PiJev guideline. PiJev had not overridden that. The extension now rewrites exactly
those two lines so that locating code goes through `pijev_search` first (`preferPijevSearch` in
`src/ui.ts`, verified in the real request), and both PiJev arms were rerun with the corrected
prompt. The plain-Pi arm is unaffected and is not rerun. Numbers below are from the rerun;
the first pass is kept in `eval/swebench-agent-results/results.json` for comparison.

## Results (corrected prompt)

| | Pi | PiJev, no Jev | PiJev + Jev |
|---|---:|---:|---:|
| **resolved** | **15/20** | 14/20 | 14/20 |
| **first tool call reads a gold file** | 5/20 | 7/20 | **11/20** |
| `pijev_search` calls / runs using it | — | 9 / 8 | 7 / 5 |
| search calls, mean / median | 4.6 / 3.0 | 5.2 / 2.0 | 4.3 / **1.5** |
| tool calls, mean / median | 17.1 / 11.0 | 16.4 / 9.0 | 16.1 / 10.0 |
| prompt tokens per task, mean / median | **192k / 47k** | 216k / 55k | 202k / 61k |
| wall time per task, mean / median | **42 s / 20 s** | 50 s / 21 s | 58 s / 29 s |
| Jev requests per task | — | — | 4.1 (+3.9 s) |

Paired against plain Pi on the same instance, PiJev + Jev used **fewer search calls on 11,
the same on 4, more on 5**; fewer tool calls on 12 of 20; more prompt tokens on 12 of 20;
more wall time on 16 of 20. First pass, for reference: PiJev + Jev resolved 15/20 with
`pijev_search` used in 1 run, 4.7 / 1.5 searches, 195k tokens, 60 s.

## What happened

**Fixing the prompt raised adoption, not outcomes.** With the guideline corrected, the model
reached for `pijev_search` in 5–8 of 20 runs instead of 1, and still one or two calls per run
with bash grep for the rest. Resolve rate did not move (15 → 14 → 14), and neither did the
means of any effort metric. What did move is the same thing that moved in the first pass:
with the Jev-ranked briefing, the first action reads the file the reference patch edits in
11 of 20 runs against 5 of 20 for plain Pi. The Stage 1 retrieval advantage reaches the
agent. It does not carry through to the result.

**Variance after localization dominates.** On 9 of 20 instances plain Pi needed fewer than
three searches: the issue text names the file. Where retrieval mattered, arms diverge both
ways. `django__django-11206`: Pi spent 37 tool calls and 414k tokens, PiJev + Jev 33 calls
and 425k after the fix (9 calls and 65k in the first pass), all resolved.
`django__django-11239`: 5 searches became 0, and then the fix was wrong. `django__django-11087`
is reproducible in the other direction: plain Pi resolved it with 5 searches in 55 s; PiJev +
Jev read the gold file *first* in both passes, then went on to 18 and 24 searches, exhausted
the budget and did not resolve it. The traces show the model second-guessing its fix — trying
to download Django 3.0, searching for other copies of `deletion.py` — rather than failing to
find the file. Medians move in PiJev's favour (searches 3 → 1.5); a few runaway runs erase the
difference in the means, and with one run per configuration a single runaway run moves a
mean by 10%.

**Jev is not free at this model's speed.** deepseek-v4-flash answers in about a second.
Four Jev requests per task plus a 6,000-file discovery pass add 16 s to a 42 s task on
average. Against Sonnet-class response times in the earlier experiments the same latency was
negligible; here it is the largest measured cost of the design.

## What this changes

The position — rerank a lexical shortlist and keep the ranker out of the context window — is
still the right one: it is the only configuration whose first move lands on the right file
more often than not. Delivery is where the evidence points. An opt-in tool, even when the
prompt says to use it first, is picked up in a quarter of runs; the model's searching still
goes through bash grep. If the reranker is to matter after turn one, it has to sit inside
that path — intercept the `grep`/`rg` output the model already asked for and rerank it —
rather than beside it. That is also where the latency has to earn its keep: a ranked grep
result is worth 2 s only where it removes more than 2 s of subsequent searching, which on
this task set is roughly half the instances.

## Separating localization from comprehension

"Search count" conflates two different kinds of work, so each run is split into phases at
two events: **L** (localize) runs until every file the reference patch edits has been read;
**C** (comprehend) runs from there to the first edit; **V** (verify) is everything after.
Only L is the retrieval tool's job. (`eval/figures/swebench-agent-phases.py`; per-run data
in `eval/swebench-agent-results/phases.json`.)

| phase | metric | Pi | PiJev, no Jev | PiJev + Jev (v2) | PiJev + Jev (v3) |
|---|---|---:|---:|---:|---:|
| **L** | calls, mean / median | 4.7 / 2 | 3.2 / 2 | 2.3 / 1 | **2.2 / 1** |
| | search calls | 1.8 / 1 | 1.3 / 1 | 0.7 / 0 | **0.6 / 0** |
| | non-gold tool output ingested | 4.9 KB | 3.4 KB | 2.0 KB | **1.7 KB** |
| **C** | calls | 3.8 / 2 | 3.2 / 1 | 6.2 / 2 | 6.2 / 3 |
| | search calls | 1.1 | 1.0 | 2.3 | 2.1 |
| **L + C** | calls before the first edit | 8.5 | 6.4 | 8.5 | 8.4 |
| **V** | calls | 8.9 | 8.9 | 7.4 | **6.6** |
| | edits after the first | 1.5 | 1.4 | 1.1 | **0.7** |
| | share of all calls (Pi) | 54% | | | |
| | resolved | 15/20 | 14/20 | 14/20 | **16/20** |

The retrieval effect is real and confined to L: the Jev-ranked briefing halves localization
calls (4.7 → 2.2), cuts localization searches by two thirds and cuts the irrelevant tool
output ingested during localization from 4.9 KB to 1.7 KB. It then gives all of it back in
C: comprehension calls rise from 3.8 to 6.2, so **calls before the first edit are identical
(8.5 vs 8.4)**. PiJev moves the work from before the model has the file to after; it does not
remove it. Half of all tool calls happen after the first edit, in a phase retrieval cannot
touch.

Two things account for the C inflation. The PiJev arms **re-read the gold file 2.5–3× as
often** during C (15–19 re-reads across 18 runs vs 6 for Pi): the briefing delivers an
excerpt, so the model fetches the whole file afterwards and then re-reads parts of it,
where Pi's first contact is already a full `read`. And the model greps for callers and
usages regardless of how it was pointed at the file (17 → 29 grep calls in C); that
searching is understanding the change, not finding the file.

## Calibrated trust (v3)

The briefing was then rewritten around what the ranker actually returns: at most three files
instead of six, each carrying Jev's relevance score, with the score explained as a
probability and how to act on it (high: work there; low: the shortlist missed, search), and
without the earlier "other files and lines may matter … expand when evidence is missing"
wording. `pijev_search`'s guideline says what it is — a judgement model ranking real excerpts
for a natural-language question, not grep — and how to use its scores.

| | Pi | PiJev + Jev (v2) | **PiJev + Jev (v3)** |
|---|---:|---:|---:|
| resolved | 15/20 | 14/20 | **16/20** |
| first tool call reads a gold file | 5/20 | 11/20 | **14/20** |
| `pijev_search` calls / runs | — | 7 / 5 | 7 / 5 |
| search calls, mean / median | 4.6 / 3.0 | 4.3 / 1.5 | 4.0 / 2.0 |
| tool calls | 17.1 | 16.1 | **14.8** |
| prompt tokens per task | 192k | 202k | **169k** |
| wall time per task | **42 s** | 58 s | 73 s |

This is the first configuration on the frontier ahead of plain Pi: one more task resolved,
12% fewer prompt tokens, 13% fewer tool calls — at 31 s more wall time, almost all of it
Jev latency (6.1 s of requests per task) plus the discovery pass. Two instances that had
failed under PiJev + Jev in both earlier passes (`11087`, `11239`) resolved; one (`11138`)
regressed. The improvement did not come where the hypothesis predicted: the comprehension
phase is unchanged (6.2 calls), and `pijev_search` usage is unchanged (7 calls in 5 runs) —
the model did not start "trusting" the tool. What changed is the verify phase: fewer
post-edit iterations (edits after the first 1.5 → 0.7), i.e. the first fix was right more
often. With one run per configuration, +1 resolved is within noise; the token and tool-call
reductions are consistent across the phase table.

## Whole top file in the briefing (v4)

The re-read finding above suggested a mechanical fix: when the top-ranked file scores at
least 0.8 and fits Pi's own 50 KB read bound, the briefing carries it whole instead of a
window. Rerun of the PiJev + Jev arm only (`eval/swebench-agent-results/v4/`).

| | Pi | v2 | v3 | **v4** |
|---|---:|---:|---:|---:|
| resolved | 15/20 | 14/20 | 16/20 | 14/20 |
| search calls | 4.6 | 4.3 | 4.0 | **3.5** |
| tool calls | 17.1 | 16.1 | 14.8 | **14.3** |
| `read` calls | 6.2 | 6.7 | 6.0 | **5.5** |
| reads of a gold file, all runs | 48 | 56 | 55 | **47** |
| prompt tokens per task | 192k | 202k | 169k | 178k |
| wall time | 42 s | 58 s | 73 s | 55 s |
| first request, prompt tokens | — | — | 3.6k | 4.4k |

The mechanism did what it was meant to: gold-file reads fall back to plain Pi's level (55
→ 47 across 20 runs), and in six runs the model edited straight from the briefing with no
`read` at all; searches, reads and tool calls are the lowest of any arm. The injected file
costs about 850 prompt tokens on the first request (the cap keeps the large files out) and
~500 per request thereafter. Outcome: 14/20, two fewer than v3 — but `11087` has alternated
resolved / budget across four PiJev + Jev runs under near-identical configurations, and
`11141` has flipped once. **At one run per configuration on twenty instances, resolve rate
cannot rank v3 against v4 against Pi; the effort metrics can, and they move consistently
with each design change (tools 16.1 → 14.8 → 14.3).** Ranking configurations on outcome
needs several seeds per instance, which this task set does not justify: on 13 of 20 the
model already opens the right file with at most one search.

## Every tool call, drawn

![execution strips](figures/execution-strips-django.png)

*Every run of plain Pi and PiJev + Jev v4 as a strip of tool calls, one block per call coloured
by kind; a white frame on the first `read` or `edit` of a gold file; the magenta block is the
briefing PiJev receives in its first prompt. (`eval/figures/execution-strips.py`; per-call data in
`eval/swebench-agent-results/execution-strips.json`.)*

The PiJev strip is shorter on 15 of 20 tasks, −16% calls in total, and the first gold touch moves
from a median second call to the first: 10 of the 20 PiJev strips open with a white-framed block,
and on five of those it is orange — the model edited the briefed file without a single `read`.
Plain Pi is already good at this repository (a gold file on the first call on 5 of 20, by the
second on 12 of 20), so the saving per task is small, and PiJev is longer on four (`11087`, the
run that alternates resolved / budget across configurations, `11211`, `10880`, `11163`). The
long rows at the top, where both arms exhaust the budget, are the same tasks in both strips.

## Limitations

- 20 instances, one repository, one main model, one run per configuration. A single
  runaway run moves a mean by 10%.
- The task set is easy for localization: 9 of 20 instances needed fewer than three searches
  for plain Pi. A set chosen for retrieval difficulty (Stage 1 knows which instances rank
  poorly under BM25) would test the hypothesis more sharply.
- `pijev_search` adoption may differ across main models; this result is specific to
  deepseek-v4-flash, and the first pass shows how sensitive adoption is to the prompt.
- One run per arm hit a transient DeepSeek "Connection error" that Pi retried; the run
  completed normally and is counted as such.
