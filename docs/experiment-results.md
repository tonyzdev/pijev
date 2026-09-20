# Experiment ledger

These are development observations, not performance claims. Initial runs use `alibaba/qwen3-coder-next`; the later comparison names its alternate model explicitly. Both use Vercel AI Gateway. Reported dollar values use the pinned Pi catalog, including its cache rates, not billing receipts; Jev fees are not included. Raw traces and disposable workspaces stay local.

Latest follow-up: [forced intervention placements](placement-experiment.md)
adds tool-output selection, post-edit test selection, and bounded completion
review, each paired with a local deterministic control. The fourteen-cell matrix
at frozen `d08fc39` was interrupted by Gateway HTTP 402 insufficient funds: one
completed local-checkpoint run, two mid-run cutoffs and eleven first-request
rejections. Eight Jev output filters were delivered (six network calls/two cache
hits); paid finish and Jev-checkpoint interventions were not exercised. The local
checkpoint candidate passes all checks and adds sixteen meaningful tests, but
no valid placement comparison exists. All outcomes, including unchanged seed
artifacts, are preserved in [placement results](../eval/placement-results/README.md).
The three mechanisms are evaluator-only; 150 offline tests pass.

The preceding [complete project source ranking](project-source-experiment.md)
runs two lexical/Jev pairs at frozen `66a8ad1`. Every eligible source/test file is
scored; neither policy uses a keyword candidate filter or top-K output cutoff.
Jev scores all 21 files in about 2.1–2.4 seconds. Jev-1 reaches its token budget
and misses tree restoration (7/8); Jev-2 passes all checks and authors meaningful
regressions. Both lexical candidates pass behavior, but one omits new tests and
the other's 19 tests exercise only locally copied logic, confirmed by passing
in an empty directory without PiJev source. Only Jev-2 completes the full task;
first-edit and efficiency signals do not repeat consistently. Full manifests,
original patches, all independent checks, review findings and replay hashes are
published. This remains evaluator-only and establishes no general advantage.

The preceding [API-anchored evidence diagnostic](api-evidence-experiment.md)
ran two more lexical/Jev pairs on the same session-mode task at `b7916d1`.
All four pass the frozen behavioral checks, typecheck and build. Lexical-1
omits required new tests; the other three add meaningful assertions, though
lexical-2 also contains a vacuous malformed-record test and Jev-2 a weak
exclusion case. Jev selects core persistence APIs consistently, but costs more
and takes longer in both pairs; investigation is not consistently reduced.
Original patches, review findings, independent logs and byte-exact replays are
published. This is task-informed diagnosis, not an unseen transfer or a product
advantage; preprocessing remains evaluator-only.

The preceding [session-mode transfer check](session-mode-evidence-experiment.md)
ran two lexical/Jev pairs at frozen `d672736`. Only lexical-1 completed the task.
Jev-1 passed all eight behavioral holdouts but its added tests failed typecheck;
lexical-2 omitted tree restoration (7/8); Jev-2 selected the oldest record (4/8)
and added no tests. Jev finished sooner in both pairs, without equivalent
accepted delivery. Original patches, independent logs and replay hashes are
published; normal product defaults remain unchanged.

The preceding [dependency evidence before investigation](dependency-evidence-experiment.md)
ran a lexical/Jev pair at `f0c4d47`. Both exhausted the token budget. The Jev
partial repair passed the original seven holdouts and exact user-entry
ownership, but failed generated-row display and omitted requested tests/docs.
Lexical left a type-invalid field rename. Jev reached edits earlier and made
fewer dependency navigation calls in this sample; main-model cost was slightly
higher. Neither completed the task, and no general benefit is established.

The earlier [post-edit test checkpoint experiment](checkpoint-experiment.md)
ran three actual CLI conditions at `eaeec35`. All timed out; the Jev condition
never edited and therefore never called Jev. The dependency selector exposed
useful intermediate failures, but its generated patch passed the original seven
holdouts while retaining a wrong-entry attribution defect and a UI mismatch.
This is an integration-placement and acceptance-gap finding, not evidence of
Jev selection accuracy or a completed repair.

## 2026-09-18: optional question-driven search

Both constructed document-lifecycle repair runs had the same 240-second wall-clock limit and requested 28 model requests / 150,000 tokens. Neither called `pijev_search`; both read 13 files. A fresh independent sandboxed acceptance run found 4 of 11 invariants passing in each workspace, including different subsets. Neither completed the task.

| Configuration | Read calls | Search calls | Main input/output tokens | Estimated main cost | Acceptance |
| --- | ---: | ---: | --- | ---: | --- |
| Plain Pi | 13 | 0 | 117,248 / 18,713 | $0.0811 | 4/11; failed |
| PiJev assist, optional search | 13 | 0 | 156,915 / 5,646 | $0.0852 | 4/11; failed |

Assist recorded two failure-triage evaluations (one network call and one cache hit), 763 ms recorded wait, and no source ranking. This does not demonstrate a quality or efficiency benefit. There is one run per condition, and no corresponding off run; do not interpret the numerical difference as a causal Jev effect.

### Invalid controls discovered from traces

- The 4,096-token per-response cap repeatedly truncated a long `write` tool call in the plain run, leaving required arguments absent. The harness now exposes a larger output allowance; this failed pilot is retained, not silently replaced.
- Throwing inside Pi's `before_provider_request` hook reports an extension error but does not stop the request. The intended request/token budget was not an effective boundary. The wall-clock limit did terminate each run. The revised control uses runtime abort; a local real-Pi loop test verifies there is no third provider request after a two-request budget.
- Original acceptance summaries were incomplete. Rechecking the preserved workspaces with the corrected, sandboxed oracle produced the complete 4/11 results above. A temporarily cached check inventory is a possible historical cause, not a proven one.

## Real CLI task: associate decisions with Pi sessions and user turns

The actual `pijev` executable was run against a disposable clone of public PiJev revision `4e1cdef`, with a task to add real session and per-user-turn identity, backward-compatible journals, presentation, documentation, and multi-turn runtime tests. Personal context and skills were disabled. The agent could execute file and shell tools inside the task workspace.

It reached 70 assistant messages before the 360-second deadline, with 27 bash calls, 29 reads and 14 edits; the first edit was tool call 36. It never called `pijev_search`. Main-model usage was 2,491,376 input and 12,430 output tokens, approximately $1.2606 at pinned catalog rates. The failed budget hook makes this unsuitable for a bounded paired comparison.

The generated patch creates a random identifier instead of reading Pi's actual session ID, and uses per-model-loop `turn_start` indices instead of stable per-user-prompt identity. It also changes the journal filename regex incorrectly. Independent telemetry/runtime checks failed 5 of 7 tests, consistent with the broken filename matching. The task was not accepted and the patch was not merged. A real CLI run is evidence of exercising the product, not proof that the resulting changes are correct.

The first real CLI sandbox also exposed two test-environment problems: a long temporary path exceeded the Unix socket path limit used by the `tsx` launcher, and local HTTP fixture servers were denied. Later runs use shorter temporary paths and explicitly allow loopback for the real repository task while continuing to deny external network access. These harness failures are not evidence against Jev.

## Next controlled comparison

Repair and verify the harness, then compare initial deterministic source evidence against the same evidence candidates ranked by Jev. Include repeat runs and a held-out second repair task. Keep the real CLI task, inspect its trace and validate its patch independently. Until then, do not advertise faster, cheaper or more accurate coding.

### Initial shortlist probe

One direct live Jev ranking per task, over 19 and 18 source windows respectively, produced the following coverage among the first six distinct files. The reference patch's touched files are used only afterward as a rough coverage proxy; a valid alternative repair need not touch exactly those files. No acceptance answers or reference code were provided to retrieval.

| Task | Deterministic shortlist | Jev shortlist | Recorded wait | Jev input/output tokens |
| --- | --- | --- | --- | --- |
| Document lifecycle | 2/4 reference files | 4/4 | 1,018 ms | 4,471 / 336 |
| Queue pagination | 1/5 reference files | 3/5 | 530 ms | 4,578 / 318 |

The queue shortlist still omits the cursor scope and boundary implementations. Better overlap is a useful intermediate observation, not proof of a better repair. Whole-task comparisons are required, including the extra context and request costs.

### Follow-up batch stopped: invalid real-CLI isolation

The first fixed-budget briefing batch was stopped after its actual CLI trace showed bash reading the development checkout outside the task clone. The CLI child intentionally receives a temporary `HOME`; deriving the protected home from that child's environment consequently protected the wrong directory. Direct sandbox-unit checks had missed the integration error. No credential read was observed, but the affected runs are excluded from performance comparisons. The simultaneous SDK pair was also stopped conservatively; its trace was not yet persisted and it is not scored.

The correction passes the parent's actual protected home explicitly, separately protects the development repository, and keeps a blocking control active if configuration is invalid. Runtime integration tests must load the extension with rewritten `HOME` and attempt real bash reads/writes. The SDK runner also needs incremental trace persistence and graceful interruption so a stopped run remains inspectable.

Trace inspection also found repeated identical searches. The initial evidence had been appended as a new user-like message after every tool response. It now remains beside the request that generated it, before newer observations, with a runtime ordering regression test. Whether this placement caused the observed repetition is unproven; the next controlled run must assess behavior.

### Fixed-revision briefing pair: no task benefit observed

At clean revision `6cfd540`, both document-lifecycle runs used initial evidence, 36 model requests, 450,000 reported tokens, a 16,384-token output allowance, and 360 seconds. Source and built-runtime digests remained unchanged. Off selected deterministic evidence; assist ranked the same candidates with Jev and retained its existing failure triage. This compares the whole assist configuration, not ranking in isolation.

| Configuration | Acceptance | Read calls | Main input/output tokens | Estimated main cost | Termination |
| --- | --- | ---: | --- | ---: | --- |
| PiJev off, initial evidence | 4/11; failed | 12 | 114,241 / 35,915 | $0.1002 | 360-second deadline |
| PiJev assist, initial evidence | 4/11; failed | 17 | 402,744 / 26,201 | $0.2328 | 360-second deadline |

Assist made three successful Jev requests (initial ranking and two failure triages), totaling 2,383 ms recorded wait and 8,687 / 454 input/output tokens. Both failed independent cancellation, stale-completion, deep-copy, TTL and listener-cleanup checks. Traces show syntax repair and cross-module interface errors; the off run also exhausted a response's output allowance while writing a test. Neither used the optional search tool. One run per condition cannot establish a general regression, but it provides no support for a speed, cost or acceptance benefit. Better reference-file overlap did not translate into a correct repair here.

The simultaneous actual-CLI assist run stopped after 29 admitted requests at the token budget (698,793 reported tokens; a response can overshoot the admission budget). It performed 7 reads, 25 bash calls and one edit in 152 seconds, costing an estimated $0.3510 for the main model. Jev recorded three evaluations, including one cache hit, and 1,832 ms wait. The only patch added two required type fields without populating them; an independent type check failed. No generated changes were merged.

That CLI trace exposed a further environment confound: Pi's system prompt advertised SDK documentation in the development installation, which the corrected sandbox denies. The model eventually found the clone's installed dependency, but wasted multiple attempts on the advertised path. The harness now rewrites these documentation hints to the clone's SDK location without weakening isolation. Both loaded-extension and actual-CLI regression tests follow the advertised path and read a local marker while confirming protected reads remain denied. This correction is a harness improvement, not a Jev benefit.

### Alternate-model comparison: mixed efficiency, equal acceptance

At clean revision `e69426d`, `anthropic/claude-sonnet-4.6` ran both tasks with the same per-run limits: 36 requests, 450,000 reported tokens, 16,384 output tokens per response, 360 seconds, and initial evidence enabled. Each condition started fresh. All four completed, passed independent acceptance, and retained unchanged source/build digests. This is one run per condition/task, not a statistical performance evaluation or a comparison with pi-jev.

| Task | Mode | Acceptance | Requests / reads | Reported tokens including cache | Elapsed | Estimated main cost |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Document lifecycle | off | 11/11 | 21 / 14 | 355,293 | 346.9 s | $0.4698 |
| Document lifecycle | assist | 11/11 | 19 / 16 | 244,043 | 294.3 s | $0.3639 |
| Queue pagination | off | 12/12 | 14 / 12 | 197,097 | 200.7 s | $0.3536 |
| Queue pagination | assist | 12/12 | 23 / 10 | 300,986 | 284.1 s | $0.4331 |

Assist recorded three successful Jev requests in each task: initial ranking plus two failure triages. Document wait totaled 2,824 ms, with 7,544 / 454 Jev input/output tokens; queue wait totaled 1,878 ms, with 8,698 / 436 tokens. The optional `pijev_search` tool was never invoked in these runs either.

The document assist run was faster and cheaper; the queue assist run was slower and more expensive. Traces show both configurations still reading most relevant source files and repairing their own tests or implementations. The source snapshot did not consistently remove investigation. Assist also changes failure advice, so this experiment does not isolate ranking from triage. Model sampling, generated test differences, shared provider load and single-run variance prevent attributing either difference to a particular Jev decision. No general efficiency advantage is established.

The real `pijev` CLI also ran with Sonnet against the pinned public PiJev task. It stopped at the token budget after 21 admitted requests, 131.8 seconds and 691,827 reported tokens (including 604,530 cache-read tokens); estimated main cost was $0.5746. Two successful Jev evaluations waited 1,762 ms. The partial patch correctly obtains the actual session ID and adds presentation fields. An independent check, all 40 existing tests, and build passed, but it adds none of the requested new tests or documentation.

Independent review identified that its generated turn UUID changes only in `before_agent_start`, which queued steering/follow-up messages bypass. A separate real-SDK regression, adapted to the candidate's `turnId` field and legacy literal-search API, confirmed two consumed user messages receive the same turn ID. Existing tests passing therefore does not establish feature acceptance. The task is incomplete and the generated patch was not merged.

### Next experiment boundary

Keep automatic briefing opt-in. Before claiming substitution, identify a concrete investigation step that disappears when Jev is enabled and measure the decision's actual adoption. Repeat complete-task comparisons, distinguish ranking from failure advice, and add a larger real-repository task where source selection is a meaningful bottleneck. The current two small repair projects and one unfinished real repository change cannot establish a product advantage.

## Test-evidence feasibility: classification is not acceptance

The [frozen source-only probe](evidence-probe.md) tests a second possible use: flagging requirements without direct test evidence. Fourteen independently authored cases received two fresh Jev requests each. Agreement with the original labels was 21/28 responses; two cases expose ambiguity in the transmitted unknown-evidence rubric and are documented separately. Clear errors include counting partial compound coverage as complete and counting a fabricated mocked client as exercising the real behavior. The protocol, cases, original labels, responses, hashes and an offline replay command are published. This is not a completion gate or a new product feature.

### Actual CLI recovery pair with and without Jev's gap hints

Both runs used the actual `bin/pijev.mjs`, clean development revision `28018e7`, and separate clones of public baseline `4e1cdef` with the exact same partial Sonnet-generated patch from the earlier real CLI task. The seed patch's SHA-256 was `64e7c4936d42dcbb67df4d1050bbbb4ed6d2852fd59c542d500bf4e70ed03772`. Neither clone received the evaluator's failing steering test during generation. Source/build digests remained unchanged throughout both runs.

This is a fresh-session recovery pilot, **not an end-to-end implementation of an automatic evidence checker**. The normal PiJev mode and source briefing were off in both conditions, isolating the additional prompt advisory from skill selection, ranking and failure triage. The common task was to complete the existing partial observability feature, documentation and meaningful runtime tests. Both prompts warned that existing tests did not establish acceptance.

The hint condition additionally received three source-only missing-test judgments from the first repetition of the diagnostic probe on the actual seed. Selection used `not_exercised`, without threshold tuning or resampling: shared per-user-turn identity, a different identity after a later user message, and a fresh identity for another session. The fourth judgment, incorrectly reporting existing multi-user-prompt test coverage, was not sent as a gap. The advisory explicitly described the check as fallible and required validating the whole task. Jev had already been called in the diagnostic; its request cost/wait is excluded from the recovery figures below.

Both used `anthropic/claude-sonnet-4.6`, thinking off, with limits of 48 admitted requests, 1,200,000 reported tokens including cache, 16,384 output tokens per response and 420 seconds. A response can overshoot the admission token budget.

| Condition | Requests / read / bash | Reported tokens | Elapsed | Estimated main cost | Independent generated-suite check | Independent steering regression |
| --- | --- | ---: | ---: | ---: | --- | --- |
| No hint | 38 / 21 / 24 | 1,231,601 | 267.0 s | $0.7053 | Failed: new runtime test records no decisions | Failed: later consumed user message reuses turn ID |
| Jev gap hint | 32 / 17 / 28 | 1,265,702 | 301.7 s | $1.0200 | 43/43 passed | Failed: later consumed user message reuses turn ID |

Both stopped at the token budget. Independent type checks and builds passed for both; neither completed the requested documentation or corrected the source implementation beyond the seed. The no-hint run edited existing integration/telemetry tests. The hint run wrote three new tests for the prompted behaviors, but its session-switch test constructs two separate sessions with separate extension instances rather than exercising a switch in a retained runtime. Its sequential `session.prompt()` test does not cover queued steering. The evaluator then added the same real-Pi steering regression to each disposable workspace and reproduced the original reused-turn-ID defect in both. These evaluator files are excluded from the generated patch.

Trace inspection matters: the no-hint model independently enumerated the same missing tests; the hint model treated the existing implementation as correct and followed the three high-level test categories. This suggests the advisory organized test writing but did not identify the missing lifecycle distinction. One pair, different generated tests, shared provider load and budget termination do not establish a general efficiency difference. No repair was accepted or merged. More passing self-authored tests is not feature acceptance.

### Revised decision boundary

Neither whole-task relevance ranking nor this missing-test advisory has demonstrated a dependable substitution benefit. Keep them experimental. Before another integration, specify the bounded judgment, the concrete action it controls, the main-model work it removes, and the independent behavioral oracle. If defining the right lifecycle cases still requires substantive reasoning, a high Jev score cannot substitute for that reasoning. Failure to demonstrate a gain here does not establish that Jev cannot help elsewhere; it narrows the claims this repository can support.
