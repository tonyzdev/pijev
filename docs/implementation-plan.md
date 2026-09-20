# PiJev Terminal Implementation Plan

**Goal:** Deliver a runnable terminal coding agent based on Pi with Jev-assisted skill selection, code search and failure triage.

**Architecture:** A thin CLI uses Pi's public SDK entry point. A first-party extension calls an isolated decision engine backed by a bounded HTTP client. Local metadata and clear fallbacks make decisions inspectable.

**Tech Stack:** TypeScript, Node >=22.19.0, Pi 0.85.1, native fetch, ripgrep, node:test via tsx.

**Spec:** [design.md](design.md)

## Global constraints

- Implement in the PiJev repository; publish the initial version on `main`.
- Exact dependency versions; install with scripts disabled; no publication or real-provider credentials required for verification.
- No raw prompts, code, tool logs or secrets in telemetry.
- Every external judgment has a deadline and a normal-Pi fallback.

## 1. Transport and decision contracts

Files: `src/jev.ts`, `src/decisions.ts`, `src/telemetry.ts`, `test/jev.test.ts`, `test/decisions.test.ts`.

- [x] Write tests using a local HTTP server: successful typed answers, invalid probability/option, timeout, cancellation, missing key, HTTP failure and cache.
- [x] Run `npm test` and observe missing-feature failures.
- [x] Implement `JevClient.evaluate(state, questions, signal?)`, returning a discriminated success/fallback result with timing and usage. Validate answers against questions.
- [x] Implement skill, relevance and error decisions using generated opaque candidate IDs; verify IDs against candidates before use.
- [x] Test real ranking and advisory behavior with fixed HTTP fixtures; ensure uncertain/failed answers preserve normal behavior.

## 2. Source retrieval

Files: `src/search.ts`, `test/search.test.ts`.

- [x] Write fixture-repository tests for matches/line numbers, option-like patterns, no matches, ignored secrets, traversal, cancellation and truncation.
- [x] Run the tests before implementation.
- [x] Implement bounded literal ripgrep retrieval with explicit argv and exact excerpts; add batch relevance ranking without hiding the existence of omitted results.

## 3. Product CLI and Pi integration

Files: `bin/pijev.mjs`, `src/cli.ts`, `src/config.ts`, `src/extension.ts`, `src/ui.ts`, `test/config.test.ts`, `test/integration.test.ts`.

- [x] Test configuration validation, mode behavior, isolated home, doctor output redaction, and headless Pi hooks with a local deterministic provider.
- [x] Implement PiJev commands, help, header, status, decision views and extension hooks.
- [x] In assist mode inject skill advice, rank search results and append fixed failure hints; observe logs only; off performs no requests.
- [x] Ensure cancel/session switch clears run-scoped state and failures never corrupt tool results.

## 4. Delivery and verification

Files: `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `.env.example`, `docs/verification.md`.

- [x] Run `npm run check`, `npm test`, `npm run build`.
- [x] Run built CLI help/doctor and an installed package smoke in a temporary directory with an isolated home.
- [x] Inspect terminal UI in a PTY; verify product header, commands and graceful exit.
- [x] Request an independent code review while completing delivery checks, fix substantive findings, and rerun affected checks.
- [x] Document exact verification and missing real-model acceptance; deliver start commands.
