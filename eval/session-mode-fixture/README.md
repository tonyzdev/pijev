# Session-native PiJev mode fixture

This is a new feature task at public PiJev commit `4e1cdefd9144beb6bb43d3f0ed7189b0609c4254`, pinned to Pi SDK 0.85.1. There is no seed patch: absence of persistence in the public baseline is the expected red case. `task.md` and its schema/precedence were fixed before candidate generation. The policy-authoring agent could read only the task and public reproduction until its policy/task freeze; the reference and evaluator tests were independently authored in this directory. This is procedural separation within one shared development workspace, not cryptographic blindness.

Candidate material is a fresh shallow base-only clone with one reachable commit, no Git remote, `TASK.md`, and `test/session-mode-visible.test.ts`. It contains no reference patch, evaluator tests, evidence, README, or later source history. Trusted installed dependencies are symlinked read-only under the sandbox. Generated candidates must finish, with their subprocesses stopped, before evaluator tests are copied in; they are removed afterward. A candidate must not resume generation after receiving hidden evaluator output if scored as the original held-out run.

## Acceptance

The visible test saves a real SDK session after `/pijev off`, reopens the disk file using a fresh extension runtime, and observes `/pijev status`. It also checks that commands do not invoke the coding model.

The eight evaluator checks use actual Pi commands, SessionManager files, AgentSession navigation and AgentSessionRuntime fork/new/resume APIs:

1. Disk reopen with each explicit mode over a different configured default.
2. Immediate restoration at ancestor and divergent branch targets, including actual tool execution after navigation before any status command.
3. Fork ancestry, independent parent/child modifications and new-session defaults.
4. No leakage when the public SDK reuses an existing resource loader/extension instance.
5. Ignore malformed, extra-field, unknown and future data while retaining older valid state.
6. Exact bounded metadata and exclusion from actual model HTTP requests and SDK context.
7. Restored assist/observe/off behavior across skill advice, ranking and failure triage, including zero off-mode Jev requests.
8. Real commands aborting intentionally held local skill and search-ranking Jev requests, then restoring off from disk.

Only the HTTP model/Jev endpoints and UI sink are fakes. Persistence and lifecycle acceptance does not manually invoke extension hooks or substitute a fake SessionManager. Invalid records are intentional inputs written using the public SDK state API. The cancellation deadline is a bounded liveness check (1.5 seconds against a five-second request timeout), while request arrival/closure is event-driven.

`ordinary` runs the baseline's 40 existing tests, explicitly excluding the visible/evaluator tests. `visible` runs one check, `holdout` runs eight, and `check`/`build` run TypeScript. The reference also supplies brief user-facing documentation; the experiment runner's common suffix requests documentation from candidates. Automated behavior checks do not establish documentation quality, TUI visual quality, real-provider correctness, every compaction/import variant, or platform support outside this macOS calibration. Review candidate documentation separately.

SDK 0.85.1 delays file creation until a first assistant response. Tests therefore include actual loopback model responses before reopening or persisted forking; they do not manufacture an assistant message. Tree navigation restores Pi's current active ancestry but does not redefine how Pi persists its leaf pointer. Pinned-package evidence is `dist/core/session-manager.js`: `_persist` defers an unflushed session without an assistant entry, while `branch` only changes the leaf pointer. `dist/core/extensions/types.d.ts` documents custom entries as state excluded from LLM context and session-start reasons including resume/fork. These scope boundaries were recorded in the task before freeze.

## Calibration and execution

Run `node --import tsx eval/session-mode-fixture/verify.ts verify` to recreate the baseline/reference matrix and sanitized evidence. Use `prepare /absolute/empty/workspace` for a public-only checkout, or the exported `prepareWorkspace` function. The explicit `{reference:true}` option is evaluator calibration only. Run `accept /absolute/finished/candidate` after generation for the hidden acceptance gate.

The sandbox uses `eval/sandbox.ts` for environment allowlisting and filesystem/network confinement. Tests may access loopback endpoints only; external coding-model/Jev calls are zero. Process groups are killed on timeout/output overflow and after the test process exits. All generated test state is temporary. Evidence uses `<candidate>`, `<repository>`, and `<home>` replacements rather than private paths.

The evaluator tests are hidden from candidate generation but were used to develop and calibrate the reference. Accordingly, “holdout” means held out from candidates, not an untouched blind validation of the reference or a representative estimate over future Pi tasks. One task and two paired model samples cannot prove general retrieval-policy superiority. Previous task scores were not consulted to select or tailor this task.
