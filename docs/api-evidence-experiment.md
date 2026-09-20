# Diagnostic: API-anchored dependency evidence

This evaluator-only experiment follows the failed completed-task comparison in
[session-mode evidence](session-mode-evidence-experiment.md). That selector
excluded declaration files and supplied doc windows whose traversal wording
did not establish the runtime order of `getBranch()`. The new hypothesis is
that linked declarations and implementations are a better unit for replacing
some of the main model's dependency navigation. Jev ranks relevance; it does
not resolve symbols, certify correctness, decide completion, or implement the
feature.

## Frozen protocol

Run two fresh lexical/Jev pairs on the unchanged session-mode task, public
reproduction and eight runtime acceptance checks. This is a task-informed
diagnostic, **not an unseen-task transfer test**: the new evidence design was
motivated by the previous traces. The task baseline remains public revision
`4e1cdefd9144beb6bb43d3f0ed7189b0609c4254`, with Pi SDK 0.85.1. Neither the
reference implementation nor holdout files are supplied to generation.

Both conditions use actual `bin/pijev.mjs`, Sonnet 4.6, medium thinking, 64 admitted
requests, 2.5 million reported tokens, 16,384 output tokens per request, and a
600-second agent limit. A response can overshoot the token admission limit.
Ordinary PiJev decisions, source briefing and automatic checkpoints are off.
The only treatment difference is ranking a common, deterministic API pool:
BM25 plus symbol overlap for lexical; one Jev batched relevance evaluation for
Jev. Both deliver six API units in the same format, with identical inventory,
pool bounds and task text. Record pool and inventory digests, actual selected
units, Jev success/fallback, usage and preprocessing duration. Main-model catalog
cost excludes Jev fees and is not a billing receipt. Evidence-plus-agent elapsed
time excludes installation and CLI startup before the parent timer.

Launch lexical then Jev in pair one; Jev then lexical in pair two. Preparation
may reorder actual agent start times, which must be reported. Conditions within
a pair run concurrently; wait for both before launching the next pair. Freeze
source, build and HEAD across all four. Do not inspect candidate acceptance
until all four generators are terminal; do not repair, resume or selectively
replace a failed run. Sampling, shared provider load, caching, workspace paths
and evidence token length remain confounds. Two repeats cannot establish
general superiority or a population success rate.

After generation, run ordinary tests, the unchanged public reproduction,
frozen runtime acceptance, typecheck and build independently. Review the actual
patch, added regression coverage and final explanation against the task. A
shorter run that misses required work is not faster accepted delivery. Inspect
traces for delivered evidence, actual dependency navigation, API body reads,
first successful edit and final validation. Tool calls mentioning
`node_modules/` are a proxy, not a count of unique facts or proof of causation.

```sh
node --env-file=.env --import tsx eval/checkpoint-run.ts \
  --task session-mode --sample 1 --dependency-policy api \
  --dependency-evidence lexical --seconds 600 --turns 64 --tokens 2500000
node --env-file=.env --import tsx eval/checkpoint-run.ts \
  --task session-mode --sample 1 --dependency-policy api \
  --dependency-evidence jev --seconds 600 --turns 64 --tokens 2500000
# Repeat with --sample 2, launching Jev before lexical.
```

## Bounds and interpretation

The extractor inspects up to two direct installed dependencies, chosen by task
and package metadata overlap. It reads owned source/declaration files with
fixed file, byte and traversal budgets. TypeScript ASTs associate class members
and top-level functions/types with same-module implementations, preserving
static/instance and ESM/CJS identities. Up to four overload declarations and
bounded head/tail implementation lines are retained, with omitted/truncated
metadata. BM25 length normalization and symbol overlap form a maximum 32-unit
pool. Both conditions apply the same 85 KB request bound, including the pinned
Gateway boolean-question serialization. Jev cannot recover an API excluded
from this pool.

This is a partial extractor, not TypeScript's full module resolver. It supports
root export strings and flat `types`/`import`/`default` conditions (all strings,
`types` first when present, runtime conditions in insertion order), direct named
exports and relative star reexports. Unsupported conditional maps, missing
wildcard targets, cycles and bounded-resolution exhaustion are disclosed as
unresolved. Import-then-export aliases, CommonJS assignment exports, namespace
exports, package subpaths, inherited members, bundled sources and variable-based
APIs can be absent. `exportedAs` identifies resolved root exports of the owning
symbol; it does not prove that a member is a public or usable API. An empty list
means unresolved, not private. Linked excerpts do not establish complete runtime
behavior. The main model must inspect missing or truncated code as necessary.

Public artifacts will retain every outcome, original patches and replay hashes.
Raw traces stay private. The product defaults remain unchanged until stronger
accepted-task evidence justifies adoption.

## Results

All four actual CLI runs ended normally at clean frozen revision
`b7916d1975936f12d93c99d37a6e64cf582c70a6`. Source and built-runtime digests match
within and across all runs. All used the same 413-file, 2,458,404-byte partial
inventory, 5,098 extracted units and 32-unit pool. The inventory digest is
`6e73470a42f4599c19f8756ed3da2925de92c006b871bf0349e16f94c4be8089`;
the pool digest is
`e44765e3f0d8f15e3c1c7c44e4fe6a7086818709c0da06351461c0848a71a754`.
The inventory is explicitly truncated; package `ai` has unresolved root exports.
No candidate received acceptance feedback during generation or was resumed.

| Run | Ordinary tests | Public / holdout | Typecheck / build | Evidence + agent | Main requests | Estimated main cost |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Lexical 1 | 40/40 | 1/1, 8/8 | pass / pass | 179.4 s | 18 | $0.4352 |
| Jev 1 | 44/44 | 1/1, 8/8 | pass / pass | 251.5 s | 29 | $0.6737 |
| Lexical 2 | 45/45 | 1/1, 8/8 | pass / pass | 293.6 s | 28 | $0.6843 |
| Jev 2 | 55/55 | 1/1, 8/8 | pass / pass | 427.6 s | 48 | $1.0148 |

Independent checks ran after all four generators stopped. No check timed out,
exceeded output limits, skipped or cancelled tests. Both conditions pass the
same behavior in both repetitions. Jev takes longer and costs more for the
main model in both pairs; there is no speed or cost advantage in this sample.
The extra authored tests differ, so this is not a comparison of identical
delivered artifacts. Main costs exclude Jev fees and are not billing receipts.
Reported main tokens including cache are 561,146 / 1,072,971 in pair one and
999,992 / 1,766,669 in pair two (lexical / Jev).

### Deliverables and test review

- **Lexical 1:** behavior passes, but it adds no tests despite the explicit
  request. The supplied reproduction and evaluator holdouts are not authored
  delivery. This is an incomplete deliverable.
- **Jev 1:** adds four actual-SDK tests for exact stored metadata, disk reopen,
  configured fallback and restoration past deliberately malformed newer
  records. These are meaningful regressions. The file's introduction mentions
  tree restoration, which those four tests do not exercise.
- **Lexical 2:** adds five tests, including useful assertions about exact
  appended metadata and repeated writes. Its malformed-record test is vacuous:
  it issues `/pijev observe` and reads status without injecting malformed data
  or restoring the session. Its final answer falsely claims that coverage.
  The newest-wins test checks live command state, not restoration precedence.
  Required artifacts are present, with these review findings retained. The
  non-exhaustive request to add tests does not justify inventing a post-hoc
  requirement to duplicate every holdout.
- **Jev 2:** adds fourteen tests of the production validation/reader helpers and
  one actual-SDK navigation test, plus a repository documentation change. The
  other-customType fixture is weak: an earlier unrelated entry need not be
  inspected because a newer valid entry returns first. The navigation test
  inspects status; the frozen evaluator separately checks behavior before
  status to establish immediate restoration.

Thus the required artifacts and automated checks are present for both Jev runs
and lexical-2, with coverage qualifications above. This is not a claim that
every new test is adequate, nor evidence that Jev caused better test writing.
All four final answers explain their changes; only Jev-2 edits a documentation
file. The common prompt did not require a README edit. Original patches,
review findings, independent logs and successful byte-level replays are in
[the public artifacts](../eval/api-evidence-results/README.md). Candidate fixes
remain artifacts; they are not adopted as product changes.

### Selection versus substitution

Both Jev evaluations succeed uncached, with 19,826 input and 570 output tokens
each. Recorded network wait is 1,641 / 1,481 ms; full preprocessing takes
2,401 / 2,488 ms. Lexical preprocessing takes 1,111 / 748 ms. Ordinary product
decisions and automatic checkpoints make zero Jev calls.

Both Jev runs select the same six units: `SessionManager.appendCustomEntry`,
`CustomEntry`, `SessionManager.getBranch`, `AgentSession.navigateTree`,
`sessionEntryToContextMessages`, and `AgentSessionRuntime.fork`. The `getBranch`
unit includes the complete runtime method, including `path.reverse()`.
Lexical selects `TreeList.applyFilter`, `CreateAgentSessionOptions.tools`,
`sessionEntryToContextMessages`, `ExtensionAPI.unregisterProvider`,
`TreeList.recalculateVisualStructure`, and `prepareBranchEntries`.
All four traces confirm actual initial evidence delivery.

| Investigation proxy | Lexical 1 | Jev 1 | Lexical 2 | Jev 2 |
| --- | ---: | ---: | ---: | ---: |
| Calls mentioning `node_modules/` | 11 | 10 | 20 | 26 |
| First successful edit/write result | 147.0 s | 106.0 s | 187.0 s | 226.7 s |

The selected APIs are more directly relevant to persistence, but the main
model still searches event declarations, extension contexts and runtime
lifecycle behavior. The second repetition reverses the earlier-edit signal
and increases dependency navigation. Both lexical candidates independently
implement the right branch order too. Supplying `path.reverse()` corrects a
known evidence omission; these traces do not establish that it caused the
Jev candidates' correctness or removed a consistent amount of investigation.

Launch order was reversed as planned, but preparation reversed the second
pair's actual user-message order: lexical's initial message is 152 ms earlier
than Jev's. Pair one's lexical message is 2,114 ms earlier. These are concurrent
descriptive repeats, not a strictly counterbalanced timing experiment.

### Decision

Keep this evaluator-only. Neither earlier editing, more directly relevant
APIs nor more authored tests establishes reliable substitution of main-model
work. This iteration establishes working API association and live selection,
with complete behavioral acceptance in both conditions, but no efficiency
advantage or superiority to pi-jev. Comparing these outcomes with the prior
document-window runs does not isolate the extractor's causal effect.

The remaining placement issue is that one whole-task relevance query supplies
a static shortlist without representing what the agent has already learned
or which uncertainty it must resolve next. A more targeted, state-dependent
selection policy is a hypothesis for a later experiment, not a demonstrated
benefit. It should be tested against the same deterministic lookup, with a
specific displaced investigation step and an untouched task before changing
product defaults. Do not expand this preprocessor merely to increase Jev calls.
