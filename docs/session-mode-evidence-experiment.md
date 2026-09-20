# Transfer check: session-native Jev mode

This experiment checks whether the frozen dependency-evidence policy transfers
beyond the attribution task used during its development. It does not add a new
ranking algorithm. `eval/dependency-evidence.ts` remains byte-for-byte the file
published at `f0c4d47`.

## Task and independence

The real PiJev feature task starts from public revision `4e1cdef`: persist the
user's selected Jev mode in Pi session/branch metadata; restore the appropriate
mode on resume and branch navigation without contaminating model context or
leaking mode between unrelated sessions. Existing mode cancellation and off
behavior must remain intact. The precise public contract is in
`eval/session-mode-fixture/task.md`.

An independent fixture author prepares the task, basic public reproduction,
reference patch and deterministic runtime acceptance using the actual installed
Pi SDK. No paid model or Jev request is involved in fixture calibration. The
generating agent receives only the task, public reproduction, source at the
base revision and its own installed dependencies. Reference/holdout files and
later repository history are excluded from its sandboxed checkout. The
retrieval policy is already frozen and is not tuned using this task's reference
or acceptance results. This is a new development task, not an independently
curated benchmark or a claim of generalization across repositories.

## Frozen comparison

Run two pairs, each with a fresh lexical condition and a fresh Jev condition.
Both use actual `bin/pijev.mjs`, Sonnet 4.6, medium thinking, 64 admitted requests,
2.5 million reported tokens, 16,384 output tokens per request, and a 600-second
agent limit. These limits are selected before generation and applied equally;
they are larger than the prior attribution pair and should not be used for a
direct timing comparison with that task. A response may overshoot the token
admission threshold. Preprocessing time and usage are recorded separately and
included in evidence-plus-agent elapsed time; dependency installation is not.

Ordinary PiJev decisions, initial source briefing and automatic checkpoints are
off. The only intervention is the existing parent-side dependency preprocessor.
Both policies receive the same bounded installed-source inventory and initial
file pool, deliver original excerpts in the same format, and leave coding and
validation to the main model. Two Jev stages may produce different window
pools after selecting files. Record stage failures rather than treating
fallback runs as full Jev treatment. No extra LLM planning turn is introduced.

Run the two conditions of each pair concurrently and reverse launch order for
the second pair. Start pair two only after both pair-one agents stop. Keep
source, build and policy unchanged across all four. Do not run candidate
acceptance checks while other generation is active. Shared provider load,
model sampling, task paths and cache state remain possible confounds; two
pairs are descriptive repeats, not statistical evidence of a general effect.

Before generation, independent review reproduced a sandbox gap: a shell could
read another candidate under a shared temporary root. The shared profile now
denies those roots, allows its own workspace, and permits only literal ancestor
metadata needed by Node path resolution. Direct and actual-CLI regressions
cover peer contents, symlink and `/tmp` aliases, local reads and Node execution.
Calibration reference trees are removed before generation. Review also
strengthened runtime acceptance with two deliberate bad variants: lazy
restoration only in `/pijev status`, and search ranking disconnected from mode
cancellation. Each now fails its intended check (7/8), without timeout or
missing tests. These control repairs do not change retrieval policy.

## Acceptance and traces

After all generating processes stop, independently run ordinary tests, the
public reproduction, frozen runtime acceptance, type check and build. Review
the actual changes against the task, including new regression coverage and
documentation. Missing requirements, budget-stopped partial patches and wrong
fixes are not completed tasks even when selected tests pass. Keep each run's
outcome; do not rerun only failed conditions or tune evidence after seeing it.

Inspect persisted CLI traces for actual initial evidence delivery, navigation
calls, first successful edit, main requests and usage, test execution, and
evidence adoption where observable. A tool argument containing `node_modules/`
is only a navigation proxy. Do not equate fewer calls, earlier editing, or
relevant snippets with accepted completion. Main-model catalog costs exclude
Jev fees and are not billing receipts.

```sh
node --env-file=.env --import tsx eval/checkpoint-run.ts \
  --task session-mode --sample 1 --dependency-evidence lexical \
  --seconds 600 --turns 64 --tokens 2500000
node --env-file=.env --import tsx eval/checkpoint-run.ts \
  --task session-mode --sample 1 --dependency-evidence jev \
  --seconds 600 --turns 64 --tokens 2500000
# Repeat with --sample 2, launching Jev before lexical.
```

Publish sanitized outcomes and reproducible candidate patches, including
failures. Keep raw traces private. The normal product retains its existing
defaults; moving the preprocessor into production requires stronger accepted
task evidence than a single promising trajectory.

## Results at the frozen revision

All four actual CLI runs ended normally within budget at clean revision
`d672736a71d48339c429b141f6436e4019c69b68`. Source and built-runtime fingerprints
were unchanged both within and across runs. The same 236-file, 2,336,099-byte
bounded inventory and initial 24-file pool were used in all four. The inventory
digest was `8aa83693e56e7fafc7b9b689066c38169ccfd5034bdf4d4311cf7d4ccdc2fd6e`.

Independent checks were run only after every generating process stopped. No
candidate received evaluator feedback or was repaired/restarted for scoring.
The [sanitized results, logs and original patches](../eval/session-mode-results/README.md)
retain every outcome.

| Run | Ordinary tests | Public / holdout | Typecheck / build | Evidence + agent time | Main requests | Estimated main cost |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Lexical 1 | 54/54 | 1/1, 8/8 | pass / pass | 352.8 s | 34 | $0.9013 |
| Jev 1 | 46/46 | 1/1, 8/8 | **fail** / pass | 282.5 s | 27 | $0.6407 |
| Lexical 2 | 43/43 | 1/1, **7/8** | pass / pass | 475.4 s | 46 | $1.2337 |
| Jev 2 | 40/40 | 1/1, **4/8** | pass / pass | 248.6 s | 35 | $0.6066 |

The ordinary baseline has 40 tests. Counts above include candidate-authored
tests and exclude the supplied public reproduction. No checks timed out,
exceeded the output limit, were skipped or were cancelled. Main cost includes
cache rates from the pinned catalog, excludes Jev fees, and is not a billing
receipt. Dependency installation is excluded from elapsed time.

Only **lexical-1** passes the complete stated task after independent code and
deliverable review. Across these two repeats, accepted tasks are lexical 1/2
and Jev 0/2. This small development sample does not estimate population success
rates or prove that Jev caused the failures.

Jev made two successful, uncached preprocessing evaluations in each repetition:
23,609 input and 852 output tokens per run. Recorded network wait was 2,304 ms
and 2,443 ms respectively; total preprocessing was 2,539 ms and 2,729 ms. Lexical
preprocessing took 242 ms and 295 ms. Ordinary PiJev decisions and automatic
checkpoints made no Jev calls in any condition.

### Failures and deliverables

- **Jev 1:** runtime behavior passes the frozen checks, but its new test helper
  uses `Parameters<Parameters<typeof test>[1]>[0]` for the context. That is not a
  valid overload extraction for the installed Node test types. Independent
  typecheck reports nine errors. The trace shows typecheck before the test file
  was added, then tests and build without a final typecheck. Build excludes the
  test file, so its success does not repair the failed required check.
- **Lexical 2:** restores only on `session_start`; it never registers
  `session_tree`. Navigating to another active branch leaves the old mode in
  memory. Its three new tests and the supplied simple reopen reproduction do
  not detect that omission; the frozen navigation check does.
- **Jev 2:** assumes `getBranch()` is newest-first and returns the first valid
  entry. The actual installed SDK returns root-to-leaf order. Multiple selections
  therefore restore the oldest, causing four independent behavioral failures.
  It adds no regression tests beyond the supplied reproduction.
- **Lexical 1:** all required automated checks pass. Its 14 added tests use the
  actual `SessionManager` to check entry validation, newest-valid precedence
  and ancestry selection. These are helper-level tests, not new extension
  lifecycle integration coverage; the supplied reproduction and frozen runtime
  checks supply that separate evidence.

None edits a repository documentation file. Each final answer explains its
changes. The common prompt asked to “document the change” without requiring a
particular file; missing README edits are reported as an artifact limitation,
not used as a new post-hoc rejection criterion. Test execution counts do not
measure coverage quality: Jev 1 also includes a test that constructs a malformed
entry without inserting it and a malformed-data test that only exercises valid
mode commands.

### What the traces establish

Both Jev repetitions selected the same six excerpts, in slightly different
order: five from `docs/session-format.md`, one from `session-manager.js`.
Lexical selected six from `docs/extensions.md`. All four received those actual
excerpts in the initial user message. This confirms a treatment difference;
it does not prove which subsequent reasoning used each excerpt.

| Navigation proxy | Lexical 1 | Jev 1 | Lexical 2 | Jev 2 |
| --- | ---: | ---: | ---: | ---: |
| Tool calls mentioning `node_modules/` | 19 | 14 | 28 | 28 |
| First successful edit/write result | 215.5 s | 149.6 s | 197.8 s | 146.8 s |

Jev reached edits earlier in both repetitions, but its shorter trajectories
ended with failed or missing required work. They do not establish faster
accepted delivery. The second pair shows no reduction in the navigation proxy.
All four still inspected declaration files; the frozen inventory explicitly
excludes `.d.ts`. Relevance ranking cannot recover evidence excluded before
ranking. Whether including those declarations would improve accepted delivery
requires another controlled comparison.

The second pair requested tool invocations in reversed order, but concurrent
process scheduling still created lexical's run ID 2 ms earlier; strict reversed
start order was not achieved. Lexical's initial user message was about 2.2 s
earlier in that pair, while Jev's was about 49.7 s earlier in pair one due to
preparation differences. Per-agent durations exclude preparation. Concurrency,
provider sampling and cache/load differences remain limitations.

### Decision

Keep this dependency preprocessor evaluator-only. These repeats do not support
a completed-task advantage, a production-default change or superiority to
pi-jev. They also do not establish that Jev caused the main model's defects or
cannot help in another placement.

The next design should make the replaced work explicit. Deterministic symbol
and export lookup belongs in code. Jev can then rank bounded, complementary
evidence for a specific uncertainty; the main model still owns cross-event
reasoning, implementation and the final validation sequence. Do not use a
relevance score as a correctness or completion decision. TypeSafe itself
recommends [atomic questions composed in code](https://docs.typesafe.ai/introduction).
This is a design hypothesis motivated by the traces, not an implemented or
validated improvement.
