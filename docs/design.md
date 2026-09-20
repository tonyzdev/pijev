# PiJev 0.1 — terminal product

PiJev is a terminal coding agent built on Pi. Jev supplies bounded semantic decisions; the user's generative model writes code, reasons across files, and uses tools. The first release is a working local CLI, not a published package or a claim of improved coding benchmarks.

## Product decision

The user selected terminal first. Use Pi's public `main(args, {extensionFactories})` SDK entry point and a bundled first-party extension. This preserves Pi's login, project trust, tools, sessions, cancellation, print and RPC modes while keeping upstream pinned. A full fork increases maintenance without enabling a necessary first-release feature; replacing the runtime from scratch discards mature behavior. The selected SDK approach still gives PiJev its own executable, home, onboarding, commands, decisions and retrieval workflow.

## User experience

- `pijev`: interactive coding session, distinct PiJev header and Jev status.
- `pijev doctor`: local configuration/credential-presence checks; never prints keys or sends network requests.
- `pijev decisions`: recent local decision metadata, no source text.
- `pijev --help`, `--version`: PiJev documentation and version.
- Standard Pi flags and `/login`, `/model`, `/resume` remain available.
- `/pijev`: capabilities, current mode, key availability and session decision statistics.
- `/pijev assist|observe|off`: change mode for this session. Assist applies suggestions; observe evaluates without injecting recommendations or changing ranking; off makes no Jev requests.
- `PIJEV_HOME` defaults to `~/.pijev/agent`. Pi authentication and sessions are isolated from `~/.pi/agent`. Jev reads `TYPESAFE_API_KEY` for TypeSafe or `AI_GATEWAY_API_KEY` for Vercel, selected by provider configuration.

## Jev integration

1. Skill selection: capture the request and roster at `before_agent_start`, then evaluate once in the first cancellable `context` hook. Rank only model-invokable skills, read a small shortlist, verify relevance, and add bounded advisory text to outgoing model context for this run. Advice is not a persistent transcript entry. Keep the original skill roster. An explicit `/skill:` choice remains authoritative. No question key is assumed to carry semantic meaning: instructions identify the state fields explicitly.
2. Code search: add `pijev_search`, which uses literal ripgrep patterns to retrieve a bounded set of source excerpts, then batches independent Jev relevance questions. Return exact paths, line numbers and excerpts; state candidate/output limits. Ranking does not prove that omitted files are irrelevant. Normal read/bash tools remain available.
3. Failure triage: only on failed tool results, classify among fixed categories and offer a fixed diagnostic hint. Preserve original tool text, error status and exit code. Never execute a retry or alter tool arguments on the classifier's authority.

## Reliability

Two transports normalize into the same decision contract: TypeSafe's native `/v1/systemone` and Vercel AI Gateway's experimental evaluation API (AI SDK 7.0.105, Gateway 4.0.85). Gateway Boolean maps to native Noul, and TypeSafe confidence is read from provider metadata. Missing required distributions, confidence or token usage fails closed to advisory fallback. Select credentials only for the configured provider; no cross-provider fallback. Gateway requests request zero data retention.

All Jev calls have a total deadline, user cancellation, strict result validation, bounded state, bounded cache and no retry storms. Missing keys, HTTP errors, malformed distributions, oversized inputs and timeouts fall back to normal Pi behavior and are visible in status/metadata. Confidence is a distribution statistic, never advertised as a probability of code correctness. Jev never authorizes commands, skips tests, or decides a task is complete.

Search launches ripgrep with an argv array, never a shell string; rejects traversal outside the working directory; respects ignore files; excludes hidden/common credential/dependency files; caps bytes, candidates and excerpt sizes. Caller paths and globs only narrow a root traversal and cannot override ignore rules or mandatory exclusions. Skill bodies and code excerpts intentionally sent to TypeSafe (via Vercel when selected) are documented; local telemetry excludes prompts, source, logs and credentials. Raw API errors are not persisted. Source text is sanitized before terminal rendering.

## Verification and acceptance

Node >=22.19.0; exact direct dependencies. Use meaningful unit tests with a local HTTP server for the real Jev transport, fixture repositories for real ripgrep, and a deterministic local provider for the full Pi runtime. Validate the CLI help, doctor, package installation and interactive UI. These tests prove integration/fallback behavior, not Jev intelligence. Live Jev and live coding-model acceptance require credentials; none are present at implementation start.

Measure baseline vs observe vs assist on real tasks before claiming gains: success, incorrect skill loads, relevant-code misses, end-to-end latency, input tokens and cost per successful task.
