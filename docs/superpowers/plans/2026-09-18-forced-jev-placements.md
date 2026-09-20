# Forced Jev Placements Implementation Plan

> **For agentic workers:** Implement these tasks in order, retaining red/green evidence and an independent review before the paid batch.

**Goal:** Compare three forced Jev decision placements against same-position deterministic controls in real Pi coding runs.

**Architecture:** Pure output-filter and completion-audit policies feed a Pi extension; reuse the existing post-edit checkpoint extension. The existing actual-CLI harness supplies isolation, budgets and provenance.

**Tech Stack:** TypeScript, Pi SDK 0.85.1, Node test, existing Jev Gateway transport.

**Spec:** docs/placement-experiment.md

## Global Constraints

- Seven conditions, two existing tasks, fourteen fresh generations.
- No product-default changes; no oracle exposure to generation.
- Freeze code/build/HEAD before paid runs; post-batch acceptance only.
- No supplied test edits or evaluator repair of candidate artifacts.

## Task 1: Decision policies and actual SDK hooks

Files: create eval/placement.ts, eval/placement-extension.ts, test/placement.test.ts,
test/placement-integration.test.ts; extend eval/checkpoint-extension.ts with an
optional checkpoint count cap.

Interfaces: filterOutput({mode, task, intent, text, provider, signal}) returns
text, selected line ranges and decision; auditFinish({mode, task, requirements,
files, observations, finalText, provider, signal}) returns gaps and decision.
createPlacementExtension installs tool_result and agent_end hooks and reports
records via onRecord. Requirements come only from public task descriptions.

- [x] Write policy tests first: selected source must be verbatim, keep order/ranges,
  Jev can choose middle chunks, fallback preserves raw output, no paid request on
  oversized state, malformed answers rejected, abort prevents applied output.
  Representative assertion: `assert.equal(result.text.includes('middle sentinel'), true)`
  with a fixture where the provider selects the middle and local control omits it.
- [x] Run `node --import tsx --test test/placement.test.ts` and observe red.
- [x] Implement policies and hooks. Keep records before observing cancellation.
- [x] Actual SDK fake-endpoint tests must show the next request sees filtered
  tool output and agent_end queues exactly one follow-up before prompt resolves.
  Representative assertion: `assert.equal(modelRequests, 3)` for attempted final
  followed by the forced review, while baseline makes two (one read, then final).
- [x] Checkpoint cap test: two edit batches with cap one execute one checkpoint.
- [x] Run the focused tests, typecheck, full suite and build; resolve review findings.

## Task 2: Actual CLI runner integration

File: eval/checkpoint-run.ts. Add --placement and mutually exclusive validation,
load the placement extension with IPC readiness, pass public task requirements,
persist intervention records and summaries, use unique run IDs for both tasks.

- [x] Add a CLI argument validation test that rejects mixed placement and evidence
  flags before credentials/network/workspace preparation.
- [x] Verify failure first, then wire CLI options/handshake and summaries.
- [x] Exercise real CLI with a local model and local Jev to establish placement
  readiness before the first provider call; retain existing sandbox restrictions.
- [x] Freeze tested source/build and commit protocol before paid generation.

## Task 3: Screening and publication

- [x] Persist an explicit 14-run manifest under .pijev before launching.
- [x] Attempt all cells (13 ended with HTTP 402; comparative screening remains incomplete). Run all cells, max three concurrent, logging every failed or terminal run.
- [x] After all terminate, independently run each fixture's five check groups.
- [x] Review actual patches/tests/final explanations; retain incompleteness.
- [ ] Publish sanitized results/patches/logs, verify hashes and replay applicability,
  update the experiment ledger/PR, push, and verify CI on the published revision.
