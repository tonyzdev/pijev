# PiJev and pi-jev

Reviewed 2026-09-18 against [pi-jev revision b3478fd](https://github.com/y0usaf/pi-jev/tree/b3478fd4ca1ac8ffcb703f6dc8d6069b555f531e). PiJev's published baseline is `4e1cdef`; question-driven discovery and initial evidence briefing are experimental work. Neither integration alone establishes better coding outcomes.

| Area | pi-jev | PiJev |
| --- | --- | --- |
| Main focus | Tool-call risk and output judgments | Skill relevance, code evidence and failure triage |
| Automatic intervention | Before bash/write/edit and after bash output | Skill suggestions, failed-tool triage; optional initial source briefing in the experiment |
| Model-selected tool | Generic typed `jev_ask` | `pijev_search` returns actual source with paths and lines |
| Product | Installable Pi extension on npm | Independent terminal command and state directory, using Pi's extension interface |
| Jev transport | TypeSafe request protocol | TypeSafe and Vercel Gateway evaluation protocols |
| Failure handling | Fail open; configurable retries and deadlines | No retries, short total deadline, cooldown and strict response validation |
| Evidence | Public small-sample calibration notes | Automated runtime tests and an explicit complete-task experiment ledger |

The competitor's automatically invoked hooks and visible verdicts are advantages in integration and inspectability. Its lightweight distribution also lets existing Pi users keep their setup. PiJev's domain-specific retrieval and Gateway support are practical differences, but readily reproducible features, not a demonstrated moat.

PiJev records actual session and user-message identifiers, but still lacks complete decision-to-action lineage and proven general task-level gains. In live pilots, models ignored its optional source tool. Initial automatic briefing is an experiment to replace some serial source-selection work, with a deterministic off baseline. Assist also enables failure triage, so the current comparison does not isolate ranking alone. It remains disabled by default.

In a single Sonnet 4.6 pair for each of two repair tasks, both off and assist passed all independent acceptance checks. Assist was faster and cheaper on document lifecycle, slower and more expensive on queue pagination. Earlier Qwen runs failed in both modes. These results establish neither consistent coding gains nor superiority to pi-jev, which has not been run head-to-head.

Our intended distinction is measurable reduction of wasted coding investigation while preserving independent acceptance. We do not claim PiJev is generally faster, cheaper, safer or more accurate. The competitor's risk gate and our retrieval feature have different objectives; a future head-to-head must report those objectives separately and hold the main model and budgets constant.

The later [post-edit checkpoint experiment](checkpoint-experiment.md) does not
change that conclusion. All three CLI runs were incomplete, and the Jev
condition never reached an edit or a Jev call. A deterministic scheduler gave
useful intermediate feedback, but the candidate still failed post-run review.
An automatic hook alone therefore does not establish either useful Jev
substitution or an advantage over the competitor's integration.

Moving dependency evidence before the first request produced a partial-progress
signal in [one lexical/Jev pair](dependency-evidence-experiment.md): the Jev
candidate passed core attribution checks but failed UI display, while lexical
left a type-invalid rename. Both exhausted their token budgets and omitted
requested tests/docs. This strengthens the case for testing the earlier
placement; it still provides no completed-task or head-to-head advantage.

The frozen policy then ran [two pairs on a new session-mode task](session-mode-evidence-experiment.md).
Only lexical-1 completed the stated task. Jev-1 passed runtime behavior but
failed typecheck; Jev-2 restored the oldest selection and added no tests.
Both Jev runs finished sooner, but the deliverables were not equivalent. These
repeats provide no reason to claim a PiJev efficiency advantage or enable the
dependency preprocessor by default. They also do not prove that Jev caused
the generated defects.

The next [API-anchored evidence diagnostic](api-evidence-experiment.md) reuses
that task with linked declarations and runtime bodies. All four candidates
pass the independent behavioral checks, typecheck and build. Jev consistently
selects core persistence APIs, but takes longer and costs more in both pairs;
the investigation-call difference reverses in the repeat. One lexical run
omits requested tests, and authored coverage has documented weaknesses in both
conditions. This supports a concrete live-selection capability, not reliable
removal of main-model work, superiority to pi-jev, or a product-default change.

Primary implementation references: [tool gate](https://github.com/y0usaf/pi-jev/blob/b3478fd4ca1ac8ffcb703f6dc8d6069b555f531e/src/gate.ts), [output judge](https://github.com/y0usaf/pi-jev/blob/b3478fd4ca1ac8ffcb703f6dc8d6069b555f531e/src/output.ts), [extension](https://github.com/y0usaf/pi-jev/blob/b3478fd4ca1ac8ffcb703f6dc8d6069b555f531e/src/index.ts), [client](https://github.com/y0usaf/pi-jev/blob/b3478fd4ca1ac8ffcb703f6dc8d6069b555f531e/src/client.ts). See our [experiment results](experiment-results.md) for the boundary between working integration and demonstrated benefit.
