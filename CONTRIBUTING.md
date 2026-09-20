# Contributing to PiJev

PiJev is an early terminal coding agent built on Pi, with Jev providing advisory decisions. Focus contributions on useful, measurable improvements to the coding workflow.

## Local development

Use Node.js 22.19 or later and install ripgrep (`rg`).

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm start
```

The test suite uses local HTTP fixtures. No provider account or API key is needed. Use `npm run dev -- --help` to run the CLI from TypeScript.

## Changes and pull requests

- Describe the problem, resulting behavior, and verification in your pull request.
- Keep Jev recommendations advisory and preserve a useful fallback.
- Cover changes to provider contracts, cancellation, mode behavior, or source retrieval with regression tests.
- Use local fixtures for automated tests. Keep real, paid API checks explicit and separate.
- Keep `.env`, credentials, session transcripts, and real source snippets from private projects out of commits, issues, and test fixtures.
- Pin dependency versions and include lockfile updates. Revalidate the experimental Gateway evaluation contract when upgrading.

An API connection check proves access and response handling. Claims about coding success, speed, or cost need representative tasks and a stated baseline.
