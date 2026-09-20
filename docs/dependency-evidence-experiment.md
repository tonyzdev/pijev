# Dependency evidence before the first model request

This is an evaluator-only placement experiment. The previous post-edit
checkpoint experiment could not help an agent that spent its entire budget
investigating installed SDK behavior without editing. This experiment moves a
bounded evidence-selection decision before that investigation begins.

## Frozen comparison

Two actual `bin/pijev.mjs` runs use the unchanged attribution task and seed in
`eval/checkpoint-fixture`. Both use Sonnet 4.6, medium thinking, at most 48
provider requests, 1.6 million reported tokens, 16,384 output tokens per request,
and a 480-second agent deadline. Each gets a fresh shallow base-only checkout
and its own installed dependencies. All ordinary PiJev decisions, source briefing,
and automatic checkpoints are off. The manual checkpoint extension remains
loaded for its established readiness handshake, without scheduling tests.

The only planned difference is the dependency-selection policy:

- **Lexical:** bounded term-based file selection, then excerpt selection.
- **Jev:** the same file candidates, ranked with atomic usefulness questions;
  then excerpt candidates from the selected files, ranked in a second batch.

Both deliver six original excerpts, with package versions, paths and line
numbers, in the same JSON format appended to the initial task. They do not
generate advice or a solution. This compares the entire two-stage policy;
second-stage window pools can differ because first-stage file selections do.
There is no additional LLM planning turn. Jev failures preserve the lexical
order of the affected stage. Parent-side evidence time and usage are recorded
separately and included in evidence-plus-agent elapsed time; dependency
installation is outside that measure. The 480-second deadline starts with the
agent, so Jev's preprocessing time is not hidden inside an equal total-time
claim.

The inventory is limited to two lexically relevant declared runtime packages,
their main-entry directories and docs. It excludes symlinks, bundled/minified
code, hidden files and nested dependencies. Limits: 32 manifests, 1,200 directory
entries, 320 source files, 4 MB read, 256 KB per file, 24 candidate files, four
expanded files, 24 candidate windows, six delivered windows. Each window is at
most 40 lines and 2,400 bytes. A digest identifies the inventory before policy
selection. The query tokenizer is English-oriented. Missing exports-only,
transitive or bundled packages and incomplete symbol cards are known limits.

## Outcome and interpretation

Primary outcome: after generation stops, the candidate must pass ordinary
tests, the visible reproduction, the original seven holdouts, type check,
build, and the two additional entry-ownership tests. Trace/diff review also
checks regression coverage and documentation requested by the task. A timed-out
or incomplete run is not an accepted completed task merely because some tests
pass.

Record provider requests, reported/cache tokens, reported model cost, Jev
status/input/latency, tool calls, time to first edit, SDK navigation calls,
actual edits, and whether supplied evidence was used. Faster progress with a
wrong fix is not a win. No model-generated patch is merged automatically.

This task and its failure modes already informed development. One live Jev
preflight on the development checkout selected queue-handling code while the
lexical probe selected mostly tool/auth documentation; neither selected the
exact persistence boundary. These probes are development diagnostics, not
blind outcomes. The additional oracle is likewise diagnostic-derived and
reported separately from the unchanged seven-test holdout. A single pair on
this task cannot establish general coding gains, superiority to pi-jev, or
robustness across model samples.

## Reproduction

Load a Gateway credential in the harness environment; it is kept out of task
shells. Run each condition from a fixed, built revision:

```sh
node --env-file=.env --import tsx eval/checkpoint-run.ts --dependency-evidence lexical
node --env-file=.env --import tsx eval/checkpoint-run.ts --dependency-evidence jev
```

Private raw traces, candidate directories, exact evidence and provenance go to
`.pijev/evals`. After the model and all its processes stop, apply the established
five checkpoint acceptance checks and `runEntryOracle(workspace)`. The oracle
is evaluator-only and never available during candidate generation. Commit
sanitized outcomes and limitations here after both runs; normal product
defaults remain unchanged pending task-level evidence.

## Observed pair at `f0c4d47`

Both runs used unchanged source/build digests and the same inventory of 276
files / 2,823,944 bytes. Both reached the 1.6-million-token admission budget;
neither completed the task. A response can overshoot the admission threshold.
The Jev condition made two successful, uncached preprocessing calls: 22,645
input / 852 output tokens, 2,292 ms recorded service wait, 2,535 ms including
local retrieval. Lexical preprocessing took 227 ms. Ordinary PiJev decisions and
automatic test execution remained off in both conditions.

| Observation | Lexical | Jev |
| --- | ---: | ---: |
| Admitted main-model requests | 44 | 31 |
| Reported main tokens, including cache | 1,616,367 | 1,602,618 |
| Main catalog cost estimate, excluding Jev | $1.03085 | $1.04542 |
| Agent / evidence-plus-agent time | 474.5 / 474.8 s | 418.5 / 421.1 s |
| Tools mentioning `node_modules/` | 40 | 24 |
| First successful edit: tool number / elapsed | 53 / 473.7 s | 31 / 337.7 s |
| Ordinary tests | 40/40 | 40/40 |
| Visible steering reproduction | 0/1 | 1/1 |
| Original frozen holdouts | 2/7 | 7/7 |
| Additional exact ownership + display checks | 0/2 | 1/2 |
| Type check / build | fail / fail | pass / pass |
| Requested new regression tests / documentation | absent / absent | absent / absent |
| Accepted completed task | no | no |

The navigation count is a trace proxy based on tool arguments, not the number
of distinct facts inspected. First-edit timing uses the first successful edit
result relative to the initial user message; it excludes preprocessing and CLI
startup. Ending earlier at a token budget is not completing a task faster.
These are one-sample outcomes, with provider/model variance and task-informed
development, not causal or general efficiency estimates.

### What the traces and independent checks establish

Both initial user messages actually contained their selected evidence. Jev
selected queue-handling windows in `agent-session.js` plus prompt-queueing docs;
lexical selected mostly tool/error/auth/RPC docs. The Jev run went first to
runtime implementation; lexical first investigated event/message types. Both
continued substantial SDK investigation. The supplied excerpts did not contain
the exact user-message persistence boundary, and their presence does not prove
that the agent used a particular Jev judgment.

The lexical run's only edit renamed the journal field without updating its
callers. It lost identity metadata and failed type check/build. The Jev run
captured the actual last consumed user entry before asynchronous work and
passed independent exact-ID, steering, follow-up, cancellation and replacement
checks. However, it wrote `userMessageId` while the seeded UI still read only
`turnId`, so new decisions displayed `t:--------`. Both the additional oracle
and independent review detected this mismatch. Neither run added the requested
regression tests or documentation. No generated patch was merged.

This is a partial-progress signal for dependency evidence at task entry. It
does not establish complete-task gains, eliminate serial investigation, or
justify enabling this preprocessor in the normal product. In particular, fewer
requests did not yield lower reported main-model cost in this pair. The next
useful test must measure evidence adoption and accepted completion, including
repeats and an unseen task, rather than optimize this known example until it
passes.

### Inspectable artifacts

[`eval/dependency-evidence-results/results.json`](../eval/dependency-evidence-results/results.json)
records hashes, both stage answers/statuses, budgets, provenance, selections,
usage and every acceptance result. The adjacent candidate patches and oracle
logs preserve the failures. Each patch is the **entire candidate source change
relative to `4e1cdef`**, including seeded changes; apply it to that base, not on
top of `seed.patch`. The unchanged visible reproduction is supplied separately
by `eval/checkpoint-fixture/visible`. Frozen seven-test and additional two-test
scores remain separate. The candidate patches are evidence, not proposed
product fixes. Raw model traces remain private and ignored.

Later control review found that the original sandbox did not block reads of
peer workspaces under shared temporary roots. The two traces above contain no
explicit other-candidate project paths in their 53/41 tool calls; that narrow
scan is not proof against every indirect access. The original pair did not
establish peer read isolation. Subsequent runs use the corrected profile and
real-CLI peer-read regressions described in the session-mode experiment.
