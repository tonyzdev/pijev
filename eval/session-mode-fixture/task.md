# Persist PiJev mode with the active Pi session branch

PiJev currently keeps `/pijev assist`, `/pijev observe`, and `/pijev off` only in the extension's memory. Implement session-native persistence using the public APIs of the installed Pi SDK 0.85.1.

Required behavior:

- A successful mode command immediately takes effect and records the selection in the active Pi session. Use a Pi custom state entry with `customType: "pijev-mode"` and data exactly `{ "version": 1, "mode": "assist" | "observe" | "off" }`. Do not write a separate preference file or modify global configuration.
- The most recent valid `pijev-mode` entry on the active branch determines the effective mode. `config.mode` is only the default when that branch has no valid entry, including for an unrelated/new session. Explicit saved `assist` overrides a configured `off` just as saved `off` overrides configured `assist`.
- Restore state when a saved session is reopened/resumed or its extension runtime is recreated. Forks inherit only the selected ancestry; later changes in parent and fork remain independent. Tree navigation immediately restores the mode at the destination, including an ancestor with no selection. Do not use a last record from another branch or leak a previous session's in-memory selection.
- Ignore records with another custom type, malformed data, additional data fields, an unknown mode, or an unsupported version. Search backward for the most recent valid record; invalid newer records must not hide an older valid selection.
- Mode records are bounded, allowlisted metadata only. They must contain no prompts, source excerpts, credentials, or arbitrary command arguments, and must not become model-context messages.
- Preserve existing status/notification text, completions, search output, and assist/observe/off semantics. Mode changes still abort pending Jev decisions and prevent stale advice/ranking from being applied. An effective `off` mode makes zero Jev requests, including after restoration.

Use Pi's normal persistence lifecycle: SDK 0.85.1 defers writing a new session until its first assistant response. You need not force unsaved, command-only sessions to disk. A selection made before the first response must survive once Pi saves that session. Tree navigation need only follow the active branch selected by Pi; do not change Pi's own persistence of its current leaf.

Add appropriate tests. The public reproduction in `test/session-mode-visible.test.ts` uses an actual local SDK session and fake loopback model endpoint; it does not need credentials or a network service. Retain the existing tests, typecheck, and build. Avoid unrelated changes and do not edit the reproduction to make it pass.
