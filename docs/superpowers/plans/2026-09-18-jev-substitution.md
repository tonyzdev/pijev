# Jev substitution experiment implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the integration sequence. Independent source discovery and benchmark fixture work may use superpowers:dispatching-parallel-agents with disjoint file ownership.

**Goal:** Implement and evaluate the first question-driven evidence acquisition experiment, while retaining the broader iterative program.

**Architecture:** Extend the existing search tool with optional natural-language discovery; retain the ordinary Pi tool loop. A separate SDK evaluation harness creates fresh workspaces and runs independent acceptance checks.

**Tech Stack:** Existing TypeScript, Pi SDK 0.85.1, Jev transports, Node test runner and ripgrep.

**Spec:** `docs/experiments.md`.

## Global Constraints

The global constraints in the experiment design are binding: no new runtime dependencies, bounded source access, cancellation, explicit truncation/fallback, no Jev in off mode, no provider credentials in model-controlled subprocess environments, and no private traces in git.

## Task 1: Independent benchmark tasks

Files: `eval/tasks.ts`, `eval/fixtures/**`, `test/eval-tasks.test.ts`.

Export `TASKS: EvaluationTask[]`, where each task has `id: string`, `prompt: string`, `setup(cwd: string): Promise<void>`, `verify(cwd: string): Promise<{ passed: boolean; checks: Record<string, boolean>; details?: string }>`, and `reference(cwd: string): Promise<void>` for validating the acceptance oracle outside agent runs.

- [x] Build two realistic multi-file repair fixtures with concurrency/cancellation and cursor pagination invariants; include visible tests and neighboring modules.
- [x] Acceptance probes must fail on the original, pass on the reference repair, and cover edge cases beyond visible examples.
- [x] Keep reference code and acceptance checks outside agent workspaces. Run independent oracle validation.

## Task 2: Bounded source discovery

Files: `src/discovery.ts`, `test/discovery.test.ts` only.

Export `discoverCode(options: { cwd: string; query: string; path?: string; glob?: string; signal?: AbortSignal }): Promise<{ candidates: CodeCandidate[]; truncated: boolean; filesScanned: number }>` using `CodeCandidate` from `src/search.ts`.

- [x] Test ignore/exclusion/path boundaries, changed source, natural-language tokenization and deterministic bounded fallback.
- [x] Enumerate permitted files via rg and build real windows, with filename and content lexical ranking as the fallback. Avoid always selecting the first alphabetical matches.
- [x] Keep total reads and candidate bytes bounded; expose limits rather than claiming exhaustive search. Return at most 32 diverse windows, preserving exact lines.
- [x] Make candidate diversity broad enough for subsequent Jev reranking without relying on the answer labels from benchmark tasks.

## Task 3: Integrate and evaluate

Files: `src/extension.ts`, `eval/run.ts`, `test/integration.test.ts`, `package.json`, and experiment documentation.

- [x] Make `patterns` optional in pijev_search; absence invokes discoverCode, then existing Jev ranking. Both off and assist use the same candidates; off uses deterministic ordering.
- [x] Verify new tool mode in real Pi runtime, cancellation, observe/off behavior and fallback. Preserve existing literal search behavior.
- [x] Build a bounded SDK runner selecting a verified available main model, with explicit mode/task/round/time settings, isolated settings and process environment.
- [x] Run baseline tasks, inspect failures and compare paired runs. Revise the experiment when the evidence contradicts it.
- [x] Review source, run full checks, commit and push verified changes and sanitized results. Record limitations and the next experiment rather than marking the overall research objective complete.

## Continuing evaluation

- [x] Fix real-CLI isolation and documentation hints based on actual traces; retain invalid and failed pilots.
- [x] Run controlled off/assist tasks with an independently verified alternate main model, include the second queue task and a real CLI repository task, then read traces and publish bounded conclusions. Repeated runs and a clean isolation of ranking remain future work; single pairs gave mixed efficiency and equal acceptance.
- [ ] Choose the next substitution experiment from demonstrated wasted reasoning, rather than adding Jev calls for their own sake.

## Pilot-driven revision

The optional search tool was not selected in the first live runs. Add an explicitly enabled initial evidence snapshot, comparing the same candidates with deterministic and Jev selection; keep the normal default unchanged. Repair the request-budget hook (Pi swallows extension exceptions), per-response output cap, task verifier isolation, and real CLI test environment before further comparisons. See `docs/experiment-results.md` for failed pilots. Full-task gains remain unproven.

## Decision trace identity

The real CLI task exposed the risk of inventing a session ID or using Pi's per-model-turn index. Associate decision metadata with the actual `sessionManager.getSessionId()` and the most recent user message entry ID on its current branch. Capture those IDs before awaiting evaluation, so cancellation or a session switch cannot relabel an in-flight result. Keep fields optional when reading old records and include them in the decisions presentation. Validate multiple decisions, successive user prompts, and a session switch through the real Pi SDK. This establishes trace identity, not adoption or task benefit.
