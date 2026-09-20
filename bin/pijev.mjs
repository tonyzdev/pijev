#!/usr/bin/env node
try {
  const { runCli } = await import("../dist/cli.js");
  await runCli(process.argv.slice(2));
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND" && error?.url?.endsWith("/dist/cli.js")) {
    console.error("PiJev has not been built. Run npm install --ignore-scripts && npm run build.");
  } else console.error(`PiJev: ${error instanceof Error ? error.message : "Unable to start."}`);
  process.exitCode = 1;
}
