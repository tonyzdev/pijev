# Run complete coding tasks

The live runners require macOS, Node >=22.19, installed dependencies, ripgrep, and an `AI_GATEWAY_API_KEY` in the launch environment. They use real model calls and incur usage charges. The TypeSafe transport can use its own Jev key in the SDK runner; the real CLI task uses Gateway. Do not put credentials in command arguments or task prompts.

```sh
npm ci
npm run build
node --import tsx eval/run.ts --list
node --env-file=.env --import tsx eval/run.ts --task document-request-lifecycle --mode off --briefing --turns 36 --tokens 450000 --seconds 360
node --env-file=.env --import tsx eval/run.ts --task document-request-lifecycle --mode assist --briefing --turns 36 --tokens 450000 --seconds 360
```

Use `queue-cursor-pagination` as the second task. Without `--briefing`, the optional natural-language search tool remains available in PiJev modes. `--mode plain` runs the ordinary Pi tool set without PiJev. Observe still incurs Jev latency and usage; it is not a zero-cost baseline. Each invocation creates a fresh workspace and cold decision cache. Compare repeat runs under the same model and budgets.

For a real repository task through the actual `pijev` executable:

```sh
node --env-file=.env --import tsx eval/dogfood.ts --mode assist --briefing --turns 36 --tokens 450000 --seconds 360
```

This starts from public PiJev revision `4e1cdef` and asks for actual session/user-turn identity in decision journals. It uses the current built executable; build first. The resulting patch is preserved for independent review, never automatically committed or applied to the development repository. This task's requirements need behavioral checking beyond its existing test suite.

Both runners save exact source/build digests, budgets, tool counts, provider usage and results under ignored `.pijev/evals/`. SDK task runs save `trace.json` and independent acceptance results; real CLI runs save `cli-trace.jsonl`, the Pi session and control statistics. These traces can contain task source and are not publishable artifacts. The ledger publishes sanitized findings only. A changed source digest invalidates a supposedly fixed-revision comparison.

The default per-response output allowance is 16,384 tokens, configurable with `--max-output-tokens`. The request budget stops new admissions; the total-token budget is checked after reported usage and can overshoot by one response's unknown input usage. Wall time stops an outstanding run. Usage prices are pinned catalog estimates, not billing receipts, and do not include Jev charges.

Agent shell commands receive a minimal environment, are restricted to workspace writes, and cannot read the development repository or user home. Constructed tasks deny networking. The real repository task permits loopback fixture servers and workspace Unix sockets while denying external network access; its Pi documentation hints point to the clone's installed SDK. This is a local trusted-task harness, not a hostile-code isolation service. No personal Pi settings, skills or context files are loaded.

See [fixture validation](fixtures/README.md), [experiment design](../docs/experiments.md) and [results](../docs/experiment-results.md). Passing unit tests validates mechanisms; only complete task acceptance and controlled repeated runs support task-performance claims.

The [forced-placement protocol](../docs/placement-experiment.md) adds
`--placement baseline|output-local|output-jev|checkpoint-local|checkpoint-jev|finish-local|finish-jev`
to `eval/checkpoint-run.ts`, with `--task session-mode|attribution`. It changes
actual tool-result delivery, executes bounded post-edit tests, or forces one
completion review. The [initial matrix](placement-results/README.md) was interrupted
by provider credit exhaustion and cannot establish comparative effectiveness.
