# Diagnostic: complete project source ranking

The hypothesis is that Jev can inspect the whole eligible project before the
main model needs to guess search patterns. This replaces candidate selection
by keyword with complete-source relevance scoring. It does not give Jev an
execution tool, code generation role, or correctness/completion authority.

## Frozen protocol

Run two fresh lexical/Jev pairs on the existing session-mode persistence task
at public baseline `4e1cdefd9144beb6bb43d3f0ed7189b0609c4254`, with Pi SDK 0.85.1.
This is a previously examined diagnostic task, not an unseen-task benchmark.
Reference patches, holdouts and previous traces are never model input.

Both policies enumerate **all owned, nonignored TS/JS source and tests** in the
candidate checkout, including the added public reproduction. No task keywords
filter the inventory. Other file types, dependencies, generated/private paths,
symlinks and deleted files are excluded and reported. This is complete coverage
of that declared scope, not a claim to read dependencies, documentation or every
byte in a repository. The lexical baseline ranks the same complete bodies by
inverse-document-frequency-weighted task-term overlap, with double path weight.
Jev sees complete files in deterministic alphabetical batches and one atomic
relevance question per file. Every file is scored, including zero-overlap files.
No hand-selected symbols, patterns, snippets or top-K candidates are supplied.

Each batch has a 75,000-byte serialized-request budget, below the existing
90,000-byte transport guard. This operational byte limit is **not** an exact
provider-token estimate. The provider's shared state/questions token limit
still applies. Files are never split or truncated: an individually oversized
file or project above 256 files / 2 MB fails before any paid request. Source is
untrusted data. Jev gets 10 seconds per call, zero retries, and preprocessing a
45-second outer deadline. Record every batch, its answer coverage and usage.
A failed or malformed batch falls back to the entire lexical ordering; never
mix lexical numbers and Jev probabilities. Cancellation terminates the run.
Batch probabilities may not be calibrated across different surrounding files;
this is an explicit limitation of merging per-batch relevance scores.

Both conditions deliver only the complete ordered file manifest (paths and line
counts), in identical wording. There is no fixed top-8 or hidden output cutoff.
The main model reads and edits files using ordinary tools. Thus the intervention
is a reading-order suggestion, not preloaded source excerpts; it may fail to
remove work or be ignored. Compare actual navigation and completed delivery,
not just whether expected files sort to the top.

Use actual `bin/pijev.mjs`, Sonnet 4.6, medium thinking, 64 admitted requests,
2.5 million reported tokens, 16,384 output tokens/request and 600 seconds/run.
Product Jev decisions, source briefing, dependency evidence and automatic
checkpoints remain off. Launch lexical then Jev in pair one; Jev then lexical
in pair two. Conditions within a pair run concurrently; wait for both before
launching the next pair. Record actual start order. Freeze code, build and HEAD
for all four. No candidate acceptance, fixes, continuation or replacement until
all four generators are terminal. An interrupted or failed run remains a result.

After all runs, independently execute ordinary tests, public reproduction,
eight frozen runtime holdouts, typecheck and build. Review actual patches,
new tests and final explanations for the task's requested deliverables. Retain
original patches and all outcomes. A passing holdout does not excuse omitted
regression tests. Timing includes preprocessing plus the parent agent timer,
but excludes dependency installation and early CLI startup. Report main-model
usage separately from Jev input/output and latency. Catalog costs are estimates,
not billing receipts. Provider caching/load and sampling remain confounds;
two repeats of one task cannot establish general superiority.

```sh
node --env-file=.env --import tsx eval/checkpoint-run.ts \
  --task session-mode --sample 1 --project-evidence lexical \
  --seconds 600 --turns 64 --tokens 2500000
node --env-file=.env --import tsx eval/checkpoint-run.ts \
  --task session-mode --sample 1 --project-evidence jev \
  --seconds 600 --turns 64 --tokens 2500000
# Repeat with sample 2, launching Jev before lexical.
```

This remains evaluator-only. Product adoption requires evidence beyond a working
transport and plausible rankings. No comparison against pi-jev is performed.

## Offline preflight

The pinned task checkout contains 21 eligible files / 90,524 source bytes.
The deterministic batches contain 14 and 7 complete files; intercepted pinned
Gateway request bodies are 71,786 and 35,775 bytes. This check makes no network
request. The whole-project inventory includes the public reproduction but
contains neither holdout nor reference code. Completed batch diagnostics are
persisted before observing cancellation; preprocessing errors get a separate
terminal record even when no main-model process starts.

## Results

All four generators ran at clean frozen revision
`66a8ad15bda4da8a98e7bb43837ef103b38bd1c9`; source and build fingerprints match
within and across runs. Every condition used the identical 21-file / 90,524-byte
inventory (digest `e3a01ef895b544ed4e694a2ee3a860a83ecb80b1d0d7ab9136bca9c8d50ca554`).
The full manifest is confirmed in each initial user message. Product decisions,
briefing and automatic checkpoints made zero Jev calls. No candidate received
acceptance feedback or was resumed.

Both Jev runs successfully scored every file in two uncached requests, with
28,661 input / 376 output tokens per run. Total preprocessing took 2,417 and
2,079 ms (recorded network waits 2,369 and 2,038 ms); lexical preprocessing took
21 and 36 ms. Both Jev rankings put the public reproduction, `src/extension.ts`,
`test/integration.test.ts`, `src/config.ts` and `src/cli.ts` first in that order.
Probabilities and later positions differ. Lexical also put the implementation
and reproduction in its first three files. These are complete eligible-source
rankings, without manually chosen patterns or omitted low-overlap candidates.

| Candidate | Termination | Evidence + agent | Main requests / reported tokens | Main cost estimate | Public / holdout | Added tests | Complete delivery |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| Lexical 1 | completed | 266.5 s | 36 / 1,100,955 | $0.6230 | 1/1, 8/8 | 0 | No: required tests omitted |
| Jev 1 | token budget | 417.5 s | 43 / 2,527,993 | $1.3288 | 1/1, 7/8 | 15 | No: tree restoration missing |
| Lexical 2 | completed | 361.7 s | 34 / 1,730,290 | $1.0149 | 1/1, 8/8 | 19 | No: tests exercise copied logic |
| Jev 2 | completed | 329.0 s | 25 / 1,431,475 | $0.9254 | 1/1, 8/8 | 20 | Yes, within this task and acceptance |

All four independently pass their ordinary suites, typecheck and build. No
check times out, exceeds output bounds, skips or cancels tests. The ordinary
counts are 40, 55, 59 and 60 respectively. Token admission can overshoot its
limit on the final admitted response; Jev-1 stops for tokens, not wall time.
Main cost estimates exclude Jev fees and are not billing receipts.

### Deliverable review

- **Lexical 1:** passing behavior but no authored regression tests. The supplied
  reproduction and evaluator tests do not satisfy the request to add tests.
- **Jev 1:** startup restoration and persistence work, but there is no
  `session_tree` handler; immediate tree-navigation restoration fails. Eleven
  added tests invoke its production parser and four use actual SDK sessions.
  Its test titled “invalid newer entries” inserts only valid observe/off entries:
  it tests newest-valid precedence, not malformed-record restoration. Budget
  termination leaves no final explanation; code comments describe parts of the
  implementation.
- **Lexical 2:** all nineteen new tests call local copies of the parser and
  branch resolver. They never import product implementation, despite comments
  claiming extension/factory coverage. A separate isolation probe copies only
  this test file into an empty directory with no PiJev source: all 19 still pass.
  Thus runtime behavior passes, but appropriate product regression coverage is
  missing. The original patch is retained without repair.
- **Jev 2:** eighteen tests invoke the production branch reader and two use
  actual SDK sessions, including command → assistant-triggered save → disk
  reopen → restored observe mode, plus no-entry fallback. Its final answer
  miscounts the unit tests as nineteen. No new tree/fork integration tests are
  authored; the unchanged evaluator establishes those behaviors. Appropriate
  new tests and a final explanation are present; no post-hoc rule requires
  duplication of every holdout or a separate README file.

### Did sorting replace investigation?

| Trace proxy | Lexical 1 | Jev 1 | Lexical 2 | Jev 2 |
| --- | ---: | ---: | ---: | ---: |
| Tool calls before first successful edit/write | 31 | 32 | 35 | 23 |
| Explicit relative `src/` or `test/` reads before that edit | 5 | 5 | 6 | 5 |
| Calls mentioning `node_modules/` across the run | 25 | 26 | 28 | 17 |
| First successful edit/write result after initial user message | 211.3 s | 248.7 s | 262.5 s | 220.6 s |

These are tool-argument proxies, not unique facts or proof of causation.
The first Jev candidate starts by reading the reproduction and extension; the
second starts with extension/configuration before the reproduction, even though
its manifest has the same leading order. Both conditions reach the relevant
local files and then investigate SDK lifecycle events and branch semantics.
The second Jev run has less navigation and completes earlier; the first does
not. Different code/tests are delivered, so comparing elapsed times alone is
not accepted-task efficiency. One complete Jev delivery out of two is not
sufficient evidence of a reliable quality advantage over the two incomplete
baseline deliveries.

Preparation reverses the intended second pair's actual model start order:
lexical's first user message precedes Jev's by 1,928 ms (2,188 ms in pair one).
This includes the extra Jev preprocessing. The experiment is concurrent and
not strictly counterbalanced. Provider load, sampling, caching and this small,
previously studied repository limit interpretation.

### Decision

The full-source approach works and removes the requirement to guess search
patterns before Jev can score a file. It does not yet establish reliable
substitution of main-model investigation. Keep it evaluator-only: the tested
intervention delivers a file reading order, while most investigation in these
traces concerns dependency behavior outside that inventory. This finding does
not rule out benefits on larger unfamiliar repositories, dynamic follow-up
queries, or a different evidence-delivery policy; none were tested here.

[Public artifacts](../eval/project-source-results/README.md) include all original
patches, independent logs, complete file-score manifests, source fingerprints,
review findings, the isolated copied-test probe and verified byte-level replays.
No candidate fixes were adopted into product defaults.
