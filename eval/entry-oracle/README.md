# Additional user-entry acceptance

This is **diagnostic-derived acceptance for future experiments**. A finished
real PiJev candidate passed the original seven frozen holdouts but assigned journal
IDs to entries that were not user messages and did not display its newly emitted
`userMessageId` field. The two tests here were written after that diagnosis.
They are a separate result, not a retrospective change to any previous seven-test
score or evidence of general coding-policy effectiveness.

Nothing in `eval/checkpoint-fixture` is changed. Its task, seed/reference patches,
visible test, and seven holdouts remain frozen. `verification.json` records their
hashes alongside the hashes of this new test and runner.

## What the two tests observe

1. Start an actual Pi SDK session against local fake model/Jev HTTP endpoints.
   Hold the first ranking response, queue steering through `session.steer()`,
   then release the response. The second identical search must hit the cache.
   Compare each persisted journal ID exactly with the corresponding actual user
   entry ID returned by `sessionManager.getBranch()`. This rejects arbitrary
   changing IDs and IDs of assistant/tool entries. Either `turnId` or
   `userMessageId` is accepted.
2. Independently repeat that runtime scenario, pass each newly generated journal
   row directly to the candidate's `formatDecisions()`, and require its emitted
   user identity to appear. Both full IDs and the original last-eight-character
   abbreviation are accepted. No synthetic row with a prescribed field name is
   substituted. This test checks display consistency; test 1 separately proves
   that the displayed identity belongs to the right SDK user entry.

Both runs verify the two consumed users, two successful ranking rows, real
session identity, one Jev HTTP call, three model HTTP calls, `[false, true]`
cache flags, and absence of sentinel prompt/source/credential content from the
persisted journal. All traffic binds `127.0.0.1` on ephemeral ports. No paid model,
gateway, live Jev service, or real credential is used.

## Usage and exposure boundary

From the development repository, after the candidate's generating model and all
its subprocesses have stopped:

```sh
node --import tsx eval/entry-oracle.ts accept /tmp/finished-candidate

# Reproduce seed/reference red-green results. A third, optional path is the
# previously diagnosed candidate, expected to fail both new tests.
node --import tsx eval/entry-oracle.ts verify
node --import tsx eval/entry-oracle.ts verify /tmp/prior-diagnosed-candidate
```

The exported `runEntryOracle(workspace)` helper in `eval/entry-oracle.ts` returns
the sanitized TAP output, exact test counts, failed test names, process exit,
timeout/output-limit flags, and a `passed` boolean requiring two passing tests.
Use `accept` or the helper for a new experiment; `verify` is the known red-green
fixture calibration, not a general candidate-scoring command.

Keep this directory and runner evaluator-only. Do not copy them, their evidence,
or reference material into the model's workspace during generation. The helper
briefly copies only the test into a fresh hidden candidate directory and removes
that directory and its sandbox profile in `finally`. Candidate source is never
patched. It also leaves `.home`/`.tmp` directories if they did not already exist;
the test removes its own scratch tree and closes its SDK session/HTTP server.

Isolation follows the existing checkpoint verifier: macOS Seatbelt, denied
external networking, writes confined to the candidate, protected actual user
home and development checkout, and an allowlisted credential-free environment.
The one supported outside dependency symlink receives a narrow read allowance
plus ancestor metadata access; candidates may instead own their dependencies.
There is no unsandboxed fallback. Each test has a 10-second deadline; the child
process group is killed on completion, a 60-second deadline, or more than 1 MB of
combined output. Missing, skipped, cancelled, or extra tests do not pass.
Returned logs replace candidate, development repository, and actual home paths
with placeholders. No machine-specific candidate path is stored in the public
fixture.

## Recorded calibration

| Candidate | Exact SDK user ownership | Generated-row display | Additional score |
| --- | --- | --- | --- |
| Frozen seed | fail | pass | 1 / 2 |
| Prepared reference (`turnId`) | pass | pass | 2 / 2 |
| Prior dependencies candidate (`userMessageId`) | fail | fail | 0 / 2 |

See `verification.json` and `evidence/*.tap` for the actual exits, assertions,
hashes, and timestamp. The prior candidate's original seven-test result remains
7 / 7. The new results are observed after generation, with diagnostic knowledge.

## Limits

This covers assist-mode source ranking with consumed steering and a cache hit,
plus formatting of newly persisted rows. It does not establish correctness of
all skill/triage paths, cancellation, follow-up, session replacement, TUI layout,
or real model behavior. Retain the original frozen tests and ordinary checks.
The helper trusts the evaluator to stop generation first; it does not discover
or stop a separately launched generating process.
