import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const exec = promisify(execFile);
test("help and doctor work without model credentials, do not expose keys or create sessions", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pijev-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { ...process.env, PIJEV_HOME: home, TYPESAFE_API_KEY: "fixture-do-not-print", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" };
  const cli = resolve("src/cli.ts");
  const help = await exec(process.execPath, ["--import", "tsx", cli, "--help"], { env });
  assert.match(help.stdout, /PiJev/);
  assert.match(help.stdout, /observe/);
  const doctor = await exec(process.execPath, ["--import", "tsx", cli, "doctor", "--json"], { env });
  const data = JSON.parse(doctor.stdout) as { jev: { keyPresent: boolean }; home: string };
  assert.equal(data.jev.keyPresent, true);
  assert.equal(data.home, home);
  assert.ok(!doctor.stdout.includes("fixture-do-not-print"));
  assert.deepEqual(await readdir(home), []);
});

test("invalid modes fail with an actionable error", async () => {
  await assert.rejects(exec(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), "--jev-mode", "invalid"], { env: { ...process.env, PIJEV_MODE: "assist" } }), (error: unknown) => {
    return error instanceof Error && "stderr" in error && String(error.stderr).includes("assist, observe, or off");
  });
});

test("doctor recognizes Gateway credentials for both Jev and the coding model without printing them", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "pijev-gateway-cli-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { ...process.env, PIJEV_HOME: home, PIJEV_JEV_PROVIDER: "vercel", TYPESAFE_API_KEY: "", AI_GATEWAY_API_KEY: "fixture-gateway-secret" };
  const result = await exec(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), "doctor", "--json"], { env });
  const data = JSON.parse(result.stdout);
  assert.equal(data.jev.provider, "vercel");
  assert.equal(data.jev.model, "typesafe-ai/jev");
  assert.ok(data.codingModel.providerKeyNamesPresent.includes("AI_GATEWAY_API_KEY"));
  assert.ok(!result.stdout.includes("fixture-gateway-secret"));
  assert.deepEqual(await readdir(home), []);
});
