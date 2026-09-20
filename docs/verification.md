# PiJev 0.1 verification

Verified locally on 2026-09-18, macOS, Node v25.9.0, npm 11.12.1. Declared minimum Node version is 22.19.0; this run used Node 25.

## Automated checks

- `npm run check`: passed.
- `npm test`: 39 tests passed, zero failures/skips.
- `npm run build`: passed.
- Dependency install used `--ignore-scripts`; npm reported zero known vulnerabilities at installation time.

The tests execute the actual pinned Pi 0.85.1 runtime against local HTTP fixtures. Both TypeSafe native and Vercel Gateway adapters are exercised in assist, observe and off modes. Each integration session searches a fixture repository with real ripgrep, receives a failing shell result, writes a real file through Pi, and completes. Assertions check advice and ordering only affect assist; observe performs evaluation without changing them; off issues zero Jev calls.

Transport checks cover request/auth protocol, selected provider credentials, typed results, caching, deadlines, cancellation, rate limits without retries, response size bounds, malformed output, and Gateway rounding metadata. Gateway tests use the real AI SDK 7.0.105 and @ai-sdk/gateway 4.0.85, with a loopback server replacing Vercel.

Regression tests and independent review cover:

- Glob and explicit-path attempts cannot bypass hidden/credential/dependency exclusions or ignore files; ambient ripgrep configuration is disabled.
- Actual `session.abort()` during skill evaluation cancels promptly, sends no second Jev call, and makes no coding-model request.
- Expanded search output strips OSC/CSI terminal commands while preserving readable lines.
- A held ranking request followed by assist → off → assist returns lexical results without stale ranking (independent review probe).
- Legitimately rounded Gateway distributions remain unchanged and are accepted using declared rounding tolerance.
- Decision journals exclude prompts, answers, source text, tool logs and secrets.

## Terminal and CLI checks

Built CLI help/version/doctor work. Doctor confirms ripgrep is present and reports credential presence only, with no network call. At the initial offline verification, neither Jev credentials nor a PiJev coding-model login was configured. See the later live connectivity check below.

PTY smoke verified the PiJev header, Gateway-specific missing-key instructions, `/pijev` status, observe/off mode switching, and clean Ctrl-D exit. Pi's inherited empty-model warning remains visible and directs users to `/login`.

## Installable artifact

`npm pack` produced `pijev-0.1.0.tgz`. Installed that tarball with `npm install --ignore-scripts` in an isolated temporary directory. The installed `pijev --version`, `pijev doctor --json`, and `pijev --pi-help` completed successfully, including loading the dependency SDK from the installed package. The package includes compiled code, CLI, README, example environment file, design/verification documents and license notices.

## Live Jev connectivity check

One minimal real evaluation was completed on 2026-09-18 through the built PiJev adapter and `typesafe-ai/jev`. The request contained only synthetic color/status facts, with no project content. Choice and Boolean results were returned and validated successfully: blue selected with probability 1; completed probability 0.98. Reported usage was 338 input tokens and 48 output tokens; client-observed request time was 1188 ms. This is one connectivity/schema check, not a latency or decision-quality benchmark. No credential value is retained in this document.

## Acceptance boundary

Real Vercel Gateway authentication, Jev evaluation access, and response normalization are now verified for one synthetic request. Coding-model and complete coding-task acceptance remain unverified. The automated tests prove protocol handling, integration behavior and fallbacks against deterministic fixtures; they do not establish decision quality, cost savings or coding-task success rates. The npm package and a Vercel-hosted application have not been published; PiJev runs locally and calls Gateway remotely.

Before claiming a gain, compare off/observe/assist on representative real tasks with success rate, skill-selection mistakes, relevant-code misses, wall time, token use and cost per successful task. Experimental Gateway evaluation APIs are pinned and should be revalidated before dependency upgrades.

## Source references

- [Pi upstream](https://github.com/earendil-works/pi)
- [TypeSafe introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [Vercel Jev launch](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway)
- [Gateway evaluation documentation](https://vercel.com/docs/ai-gateway/modalities/evaluation)
- [AI SDK evaluation contract](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)
