# Can Jev identify missing test evidence?

This experiment evaluates a possible advisory use, not an implemented PiJev feature. The product does not use these scores to declare completion, skip acceptance checks, or block a response.

The motivating failure is concrete: an actual `pijev` run produced a session/turn observability patch that passed the existing 40 tests but reused a turn ID after a consumed steering message. An independently added test through the real Pi SDK exposed the defect. Could a small Jev judgment flag missing tests before the main model finishes?

## Frozen test-source probe

The question asks whether supplied test source directly exercises one requirement. Responses are `exercised`, `not_exercised`, or `insufficient_evidence`. The task explicitly excludes deciding whether the implementation is correct or whether tests executed or passed. See the exact [protocol](../eval/evidence/protocol.json).

An independent fixture author constructed 14 cases after the question was frozen: seven document-lifecycle cases and seven queue-pagination cases. Labels were stored separately. The request contained only each requirement and its supplied source files, with opaque case IDs kept outside the model state. Labels were read only after all responses were saved. Each case received two fresh-client requests, avoiding the in-memory cache. These are 14 constructed cases, not 28 independent examples or a representative coding benchmark.

All 28 Vercel Gateway requests to `typesafe-ai/jev` succeeded. Agreement with the original labels was **21/28 responses**. One case changed its categorical answer between repetitions. Recorded request latency was 358–830 ms, median 420 ms, totaling 13,050 ms for sequential requests. Usage was 21,724 input and 1,447 output tokens. These local client measurements are not provider inference latency or an invoice.

| Original label | Answer: exercised | Answer: not exercised | Answer: insufficient evidence |
| --- | ---: | ---: | ---: |
| exercised | 10 | 0 | 0 |
| not exercised | 3 | 9 | 0 |
| insufficient evidence | 2 | 2 | 2 |

### Model errors and protocol limitations

Independent review retained every original label and separated the mismatches:

- **c03, clear error in both responses.** The requirement includes microsecond ordering and priority tie-breaking. The test uses unequal timestamps with equal priorities. Jev counts it as exercising the compound requirement despite the explicit exclusion of partial coverage.
- **c12, clear error in one response.** A fabricated mocked client is called; the real factory is unused and no upstream cancellation signal is observed. Jev first answers `exercised`, then `not_exercised`.
- **c07, rubric alignment gap.** Setup data, options, and expected values come from an omitted file. The original unknown label is defensible, but the transmitted definition specifically mentions omitted test/assertion *bodies*, not omitted data. Jev answers `not_exercised` twice.
- **c10, rubric alignment gap and unsupported enablement assumption.** The relevant test body is supplied, but an omitted flag controls whether it is skipped. The original rubric requires an enabled test, yet its unknown option does not expressly include missing enablement information. Jev answers `exercised` twice, with probabilities 0.96 and 0.95. These are not clean model-only failures against a perfectly specified question.

Do not silently relabel c07/c10, replace the main denominator after seeing the answers, or tune a confidence threshold on these examples and call it calibrated. A future independently frozen protocol should explicitly include missing setup data, expected values, helper bodies, and enablement conditions. It will require new held-out cases.

## Diagnostic probe on the actual generated patch

Separately, four requirements were paired with the generated patch's existing integration/telemetry tests and with the development version's expanded runtime tests. This was a selected, known-bug diagnostic, **not a blind validation set**. Two requests were made for each of the eight combinations.

Jev correctly flagged absent evidence for sharing a turn identity across evaluations, changing it for a later user message, and changing the session identity on a switch. But it twice said the old tests covered multiple user prompts in the same session. Inspection shows one `session.prompt` per independently created session; several model/tool loop iterations are not several user prompts. The probabilities for this false positive were 0.84 and 0.67. The expanded tests received `exercised` for all four requirements in both repetitions.

The 16 diagnostic requests succeeded, totaling 76,876 input / 822 output tokens and 10,080 ms recorded wait. The diagnostic supports trying a missing-evidence advisory. It does not support a completion gate or an end-to-end benefit claim. Supplying the right requirements and complete test context is itself unresolved product work.

## Reproduce and inspect

Replay the committed responses, with no key or network requests:

```sh
node --import tsx eval/evidence-probe.ts
```

Run the same question and cases against the configured provider, incurring 28 requests:

```sh
node --env-file=.env --import tsx eval/evidence-probe.ts --live
```

New results are written incrementally under ignored `.pijev/evidence-probes/`; the committed snapshot is never overwritten. The runner does not execute source snippets. It loads labels only after persisting the responses. A [frozen manifest](../eval/evidence/manifest.json) binds replay to the original question, cases, labels and responses; editing one without updating the manifest fails rather than silently rescoring old responses as a new experiment. Published cases are now development data, not a fresh holdout for future prompt tuning.

The original artifacts are byte-preserved:

| Artifact | SHA-256 |
| --- | --- |
| [Protocol](../eval/evidence/protocol.json) | `bac16aae4ea03ab616694dce208e4e8908c37c1b997acf60ca7fa84f09889ec8` |
| [Cases](../eval/evidence/cases.json) | `927e804e99a34ee9bc3ba24602744966fd9dd64e72aaf5a45ec7f1fe1d6227c8` |
| [Labels and rationales](../eval/evidence/labels.json) | `182c0fc95b84bcd0465dc7a598b3c2048cff9ac6e8999656e6421738e98e210d` |
| [Responses](../eval/evidence/snapshot.json) | `96adb30c103971ca73eed649df8808312cd28df82bf44f955d813cf7eba6663c` |

The real-repository advisory experiment and acceptance belong in the [experiment ledger](experiment-results.md). Classification agreement alone cannot establish that a coding agent became more reliable or efficient.
