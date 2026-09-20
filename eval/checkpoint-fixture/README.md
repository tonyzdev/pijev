# Real PiJev decision-attribution checkpoint task

This is one bounded regression task for comparing test-selection policies. It is
not evidence that a selector improves coding performance. The agent starts with
a genuine previous PiJev-generated partial patch on public commit
`4e1cdefd9144beb6bb43d3f0ed7189b0609c4254`. The original 40 tests pass, while a
real Pi SDK steering reproduction fails.

## Files and exposure boundary

- `seed.patch`: byte-preserved `git diff --binary` of the preserved generated
  workspace's tracked changes only. It changes `src/extension.ts`,
  `src/telemetry.ts`, and `src/ui.ts`. No `.acceptance`, `.home`, or `.tmp`
  content is included. SHA-256 is recorded in `verification.json`.
- `task.md`: the ordinary implementation request given to the main model.
- `visible/decision-regression.test.ts.txt`: copy to
  `test/decision-regression.test.ts` before the model starts. It reproduces
  consumed steering followed by a cached code-ranking evaluation.
- `holdout/decision-lifecycle.test.ts.txt`: evaluator-only runtime checks. Copy
  into a finished candidate only after its model run ends, then remove it.
- `reference.patch`: evaluator-only minimal repair relative to the seeded
  baseline, plus documentation. It retains `turnId` and uses the actual consumed
  user entry identity; acceptance also permits `userMessageId`.
- `verify.ts`: prepare a base-only checkout, run sandboxed local checks, or run
  post-candidate acceptance. `verification.json` and `evidence/*.tap` are the
  recorded verification results, not model input.

Do not expose this README, the holdout, the reference, verification logs, or the
preserved generated workspace to the main model. Preparation fetches only the
base commit with depth 1, preventing later fixed source from being visible in
Git history. The runner must also deny model filesystem access to the parent
repository, evaluator assets, and preserved seed workspace. A checked-out
candidate receives only base repository files, the seed patch's changes, the
visible test, and `TASK.md`.

## Local execution

From the PiJev repository root with its locked dependencies installed:

```sh
# Reproduce the complete seed/reference red-green matrix.
node --import tsx eval/checkpoint-fixture/verify.ts verify

# Prepare an empty destination for an experimental candidate.
node --import tsx eval/checkpoint-fixture/verify.ts prepare /tmp/pijev-checkpoint-candidate

# Ordinary public reproduction, from that candidate.
cd /tmp/pijev-checkpoint-candidate
node --import tsx --test test/decision-regression.test.ts

# Run independent acceptance after the model has stopped, from the PiJev root.
node --import tsx eval/checkpoint-fixture/verify.ts accept /tmp/pijev-checkpoint-candidate
```

`prepare` requires a nonexistent destination. To validate the reference manually,
prepare a fresh candidate, apply `reference.patch` there, then run `accept`.
The test file templates intentionally end in `.txt`: they are compiled and run
from the candidate, with its source imports, not accidentally collected from the
parent repository.

The verifier uses `eval/sandbox.ts`'s `shellEnvironment` allowlist, discards
inherited credentials and proxy settings, confines writes to a disposable
checkout, blocks reads of the actual user home and development repository, and
enables only loopback networking through macOS Seatbelt. The fixture's trusted
`node_modules` symlink receives a narrow read allowance; its ancestor directories
receive metadata-only permission for Node's realpath traversal. A live candidate
may instead install dependencies inside its own workspace. Preparation leaves no
Git remote and only one reachable commit. `evidence/isolation.json` records direct
read-denial, credential-environment, dependency-access and history checks. Model
requests use a minimal local OpenAI-compatible SSE endpoint; Jev requests use a
local fixed JSON endpoint. Both endpoints bind `127.0.0.1` with ephemeral ports.
No live Jev, gateway, or paid-model request is used. SDK version is pinned at
`@earendil-works/pi-coding-agent@0.85.1`; the recorded run uses Node 25.9.0.

## What the holdout observes

1. Queue `followUp()` while an actual ranking HTTP request is pending. After it
   is consumed, two evaluations share the follow-up identity and differ from the
   preceding message. Multiple evaluations of one message remain stable, and
   cache hits still acquire the appropriate ownership.
2. Consume steering after a first evaluation, wait for the second message's
   actual ranking HTTP request, queue follow-up, restore that unconsumed input
   with `clearQueue()`, then call `abort()`. The cancelled row belongs to the
   consumed steering message, not the preceding or queued message.
3. Call supported `AgentSessionRuntime.newSession()` while ranking is pending.
   The SDK settles the cancelled decision in the old session, replaces the
   runtime, and starts a decision in the new actual session ID.
4. Verify assist/observe/off transport and ranking behavior, the journal metadata
   allowlist and absence of sentinel prompt/source/credential text, and old
   records without attribution fields remaining readable/renderable.

All coordination uses actual HTTP arrival or SDK completion boundaries. There
are no arbitrary sleeps. Node test timeouts, a 60-second parent process-group watchdog, and a 1 MB combined
output cap bound failures. The process group is terminated on completion,
timeout, or output overflow; a missing TAP result or wrong test count is not a
pass.

## Recorded result

| Check | Seed | Minimal reference |
| --- | --- | --- |
| Original repository tests | 40 / 40 pass | 40 / 40 pass |
| Visible steering regression | 0 / 1 pass | 1 / 1 pass |
| Independent runtime holdout | 5 / 7 pass | 7 / 7 pass |
| Typecheck | pass | pass |
| Build | pass | pass |

The two red holdouts are consumed follow-up attribution and cancelled consumed
steering attribution. Other cases are preservation checks that already pass on
the seed. Exact exit codes, counts, failure names, hashes, and timestamps are in
`verification.json`; TAP logs identify the failed behavioral assertions.
`evidence/naming-compatibility.json` additionally records the visible test,
holdout and typecheck passing after the reference's `turnId` field is renamed to
`userMessageId`, verifying that acceptance does not prescribe that spelling.

## Limits

The supported SDK replacement path awaits old work and creates a new extension
instance. This fixture therefore does not pretend to prove behavior for an
unsupported overlapping same-instance rebind. It verifies ownership through
supported lifecycle transitions; code review is still needed to establish that
all decision paths capture ownership before their asynchronous work. The public
SDK also does not promise that `abort()` alone drops queued follow-up input;
the cancellation case uses the documented `clearQueue()` restore operation.

The holdout is independently authored from behavioral invariants and does not
compare candidate code or patch text to the reference. It exercises code-ranking
ownership through real SDK paths; it is not exhaustive coverage of every skill,
triage, UI, TUI, RPC, persistent-session, or platform combination. Existing tests
remain relevant. This macOS verifier intentionally refuses to fall back to an
unsandboxed test run. Candidate subprocesses must not be active while acceptance
material is briefly copied into the candidate. No commit or production change is
made by this fixture.
