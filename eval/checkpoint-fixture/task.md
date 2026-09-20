Fix decision attribution across real Pi user-message lifecycles.

The current partial implementation adds `sessionId` and `turnId` to the local
Jev decision journal and renders them in `/pijev decisions`. Ordinary tests pass,
but `test/decision-regression.test.ts` reproduces an attribution error: a
steering message consumed during one agent run gets the same turn identity as
the preceding user message, including on a cached decision.

Make each evaluation belong to its actual Pi session and consumed user message.
Different consumed user messages must have different identities; evaluations
for one message must retain a stable identity. Capture ownership before
asynchronous work so a pending or cancelled decision cannot inherit the identity
of a later message or session. Queued input is not yet a consumed user message.
Use the installed Pi SDK's actual lifecycle and public APIs. The field may be
called `turnId` or `userMessageId`; keep it opaque and do not derive it from
prompt text.

Keep `assist`, `observe` and `off` behavior intact, including zero Jev calls in
`off`. Preserve metadata privacy (no prompts, source text, credentials or raw
errors) and compatibility with journal rows that predate attribution fields.
Add appropriate regression coverage and document the resulting semantics.

Run the ordinary failing reproduction with:

    npx tsx --test test/decision-regression.test.ts

Use only deterministic local fixtures for model/Jev requests during validation.
Do not call live Jev or a paid model. Keep the change focused on the attribution
problem. Do not change dependency versions or test scripts.
