# Forced Jev placement screening

## Question and fixed design

Earlier work predominantly changed retrieval evidence before investigation. This
screening instead changes WHEN a decision runs, WHAT it judges, and WHICH action
it controls. It is evaluator-only. Use two existing tasks: session-mode and
attribution, both pinned to public baseline 4e1cdef (attribution includes its
unchanged public seed). Both are previously studied tasks, not unseen holdouts.

Run one fresh generation for each of seven conditions on each task (14 total):

| Condition | Trigger | Decision/action |
| --- | --- | --- |
| baseline | none | ordinary PiJev, Jev off |
| output-local | first eight eligible read/search outputs | retain alternating head/tail chunks, half of chunks |
| output-jev | same trigger/budget | rank all output chunks against task and latest assistant intent; retain half |
| checkpoint-local | first six changed-source tool batches | dependency-distance selection of two existing tests, execute immediately |
| checkpoint-jev | same trigger/budget | batched test-relevance Noul on diff/catalog, execute two selected tests |
| finish-local | first normal attempted final response | force one continuation with full public-requirement checklist |
| finish-jev | first two normal attempted final responses | atomic requirement evidence Noul; below 0.5 triggers one bounded continuation |

Output filtering uses 12-output-line chunks in original order after selection,
explicitly marks omitted output, and permits recovery by smaller reads. It never
filters failed tools or recognized test/build/check commands. Eligibility is
128–48,000 UTF-8 bytes and at least two chunks; larger output remains unchanged.
Every candidate chunk is scored, with at most 64 chunks per call. The 50% quota
is a deliberately strong experimental intervention, not a tuned optimal limit.
Only successful plain-text read/bash results are eligible. The local comparator
uses the same chunks, count and delivery format; Jev failure keeps the raw output.

Completion auditing sees explicitly listed deleted paths and complete changed source/test files within a 60 KB
request-state budget, the public task requirements, last eight tool observations
(up to 1,000 chars each), and proposed final answer. Oversize state skips the
model audit rather than pretending to inspect truncated files. No holdouts,
reference patches or prior traces are given to Jev or the coding model. Missing
evidence is a request to verify, never a proof of a defect or permission to
claim success. Completion can force at most one extra continuation; budget/error
termination is not treated as a normal final answer. Local completion control
always requests that same one extra review, covering the extra-work confound.

All conditions use actual bin/pijev.mjs, Sonnet 4.6, medium thinking, 64 admitted
requests, 3 million reported tokens, 16,384 max output tokens/request and 600s.
All ordinary PiJev Jev features, prior source/dependency briefings and checkpoints
outside the assigned intervention are off. Jev uses a 3.5s deadline and no retries
for output/finish calls (existing checkpoint transport retains its 1.8s bound).
Record trigger, actual call/result, selected content/tests, forced continuation,
fallback, bytes before/after and usage; a zero-call arm is a failure to exercise
the mechanism, not evidence of its efficacy.

Freeze implementation/build/HEAD before all 14. Run at most three concurrently
with interleaved task/condition order frozen in the batch manifest. No acceptance
inspection, candidate repair, continuation outside the assigned policy, or
selective retry before all generators terminate. Preserve every outcome.
Afterward run ordinary tests, public reproduction, frozen holdout, typecheck and
build, plus inspect authored tests and documentation. Compare each Jev placement
against both baseline and its deterministic same-position control. Report
behavioral acceptance separately from requested deliverables, and costs/time
including intervention overhead. One run per cell is screening, not statistical
proof or a product recommendation. Follow-up replication requires a separate
frozen protocol; never quietly tune this matrix after seeing outcomes.

The question design follows TypeSafe's [atomic judgments composed in code](https://docs.typesafe.ai/introduction)
and [state/questions contract](https://docs.typesafe.ai/primitives). Provider
probabilities remain fallible; actual tests remain the acceptance authority.

The immutable launch queue is recorded in [placement-manifest.json](../eval/placement-manifest.json). Three workers take its next cell when a slot opens; wall-clock finish order is not predetermined. Each cell runs once even if a different cell fails.

## Recorded outcome

The first frozen matrix was interrupted by Gateway HTTP 402 insufficient funds.
One cell completed, two were cut off during work, and eleven were rejected on
their first request. See [all outcomes and limitations](../eval/placement-results/README.md).
The intended comparative experiment remains incomplete; no placement was
promoted to the product.
