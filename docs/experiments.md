# Jev substitution experiments

The objective is to replace judgments a generative coding model repeatedly makes with small, typed decisions when doing so improves complete tasks. Pi's small execution loop remains the foundation. This is an ongoing research and implementation program, not a claim that integration alone is a benefit.

## First principles

An agent must generate hypotheses and changes, acquire evidence, select useful evidence, update its hypotheses, and validate outcomes. Generation and multi-hop reasoning stay with the coding model. File access, budgets, exact comparisons, and test execution belong in code. Semantic relevance, whether an observation changes an earlier hypothesis, and whether an evidence item addresses a particular requirement are candidates for Jev.

The optimization target is the whole task, including extra service latency, false negatives, context loss, and user interruptions. A decision that only adds a model call is not a successful substitution.

## Candidate experiments

1. **Question-driven source acquisition.** The coding model normally invents identifiers, scans matches, and chooses files across multiple rounds. Give it a bounded natural-language source query instead: select actual source windows with Jev, retaining exact paths and lines. Compare against the same retrieval without Jev and against ordinary Pi. Start here because retrieval has inspectable outputs and recoverable mistakes.
2. **Evidence-change detection.** Instead of making the coding model reinterpret repeated logs, ask whether a new observation supports, contradicts, or adds nothing to an explicit hypothesis. Only meaningful changes should cause replanning. Exact duplicates belong in a hash comparison, not Jev.
3. **Constraint-aware working context.** Preserve user requirements and executable evidence; select relevant past observations extractively rather than asking a generative model to rewrite the entire history. Errors of omission and later requirement changes require dedicated tests before adoption.
4. **Failure representatives.** From a large failing test run, identify distinct failure families and evidence representative of each, preserving access to the full log. Evaluate whether this reduces repair loops without hiding secondary failures.

These are hypotheses, not a feature checklist. Reject or revise experiments that do not improve results. Do not build universal completion or permission decisions out of Jev probabilities.

## Experiment 1 design

Extend the existing `pijev_search` tool, keeping literal-pattern search available. A query without patterns enables bounded source discovery: enumerate permitted source files, build small source cards, select candidates, and return actual source windows with line references. Candidate selection and window relevance are independent typed judgments. Do not return invented summaries. Small source windows keep the inference local; lexical retrieval and ordinary read/bash remain recovery paths.

The initial prototype is opt-in through an explicit natural-language tool invocation. It must state file/window limits, truncation, fallback and ranking status. Only measured gains justify enabling automatic retrieval by default. The comparison must separate the benefit of a new retrieval tool from the incremental contribution of Jev.

### Revision: optional initial evidence briefing

The initial live repair runs and the real CLI repository task did not call `pijev_search`. Adding a tool did not replace the model's existing sequence of searches and reads. This is a negative adoption observation, not a relevance-accuracy measurement.

An explicitly enabled `PIJEV_SOURCE_BRIEFING=1` experiment now acquires source evidence before the first coding-model request of each user prompt. It injects at most six distinct files' exact excerpts from the same bounded candidates. Assist reranks with Jev; off and observe inject deterministic discovery order, so a paired off/assist comparison isolates Jev's contribution. The default remains disabled. No skills, tools or existing conversation messages are removed. Each new prompt refreshes the snapshot, which is labeled as predating edits. Missing discovery tools or failed evaluation leave ordinary investigation available. This is a local workspace mechanism: excluded dependency APIs and unscanned sources are still gaps.

The current off/assist runs compare the complete assist configuration: assist also supplies Jev failure-triage advice. They do not identify the effect of ranking alone. A ranking-specific experiment must hold triage constant, and repeated runs are needed before attributing mixed timing or cost differences to either mechanism.

The snapshot is placed beside its activating user request, before later assistant/tool observations. A consumed steering message suppresses the previous request's advice; it must not reappear as fresh evidence after each tool response. The hypothesis is fewer model-driven source-selection rounds without lower acceptance, after counting the initial retrieval, context tokens and Jev latency. Initial evidence must not be described as implementation correctness or instruction fulfillment. A real CLI run generated its own session identifier despite being asked for the actual runtime ID; satisfying explicit task constraints remains a separate problem from finding generally relevant code.

Global constraints:

- Node >=22.19.0, TypeScript, existing dependencies only.
- Normal Pi read/bash/edit/write semantics and cancellation remain available.
- No hidden files, credential files, dependencies, generated artifacts, outside-root paths or symlinks may bypass source exclusions.
- Scores only select evidence; they never authorize effects or prove correctness.
- Off mode sends no Jev request. Observe evaluates without applying selection. Unavailable Jev yields a useful, explicitly marked deterministic fallback.
- Task benchmarks run in fresh disposable workspaces, with no personal settings, skills, sessions or credentials in the agent-visible files.
- Main-model and Jev credentials remain in the harness process; tool subprocesses must not inherit them.
- Raw traces are local and ignored. Publish only sanitized reproducible fixtures, commands, aggregate evidence and limitations.

## Evaluation protocol

Use multi-file repair tasks with cross-cutting invariants and independent behavioral acceptance tests kept outside agent workspaces. Include ordinary visible tests and plausible neighboring implementations; avoid designing fixtures to fit the retrieval algorithm. Verify the original implementation fails acceptance and an independent reference repair passes before using a task to score agents.

Compare plain Pi, PiJev off, and PiJev assist with the same coding model, prompt, tool-round/token/time budgets, clean initial files, and repeated runs. Record task acceptance, tool calls, coding-model usage/cost, Jev usage/wait/fallback, end-to-end time and errors. No after-the-fact threshold changes on held-out cases. Add pinned real-world repository tasks after the harness works; constructed tasks alone cannot establish general coding performance.

Keep an experiment ledger with failed runs and rejected ideas. Publish incremental tested commits, not unqualified speed or accuracy claims.
