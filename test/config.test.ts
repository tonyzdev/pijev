import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("keeps PiJev state separate from Pi and defaults to assist mode", () => {
  const config = loadConfig({}, "/users/tester");
  assert.equal(config.home, "/users/tester/.pijev/agent");
  assert.equal(config.mode, "assist");
  assert.equal(config.apiKey, undefined);
});

test("validates mode, deadline and HTTPS endpoint without including credential values", () => {
  for (const env of [
    { PIJEV_MODE: "whatever" },
    { PIJEV_JEV_TIMEOUT_MS: "0" },
    { PIJEV_JEV_TIMEOUT_MS: "Infinity" },
    { PIJEV_JEV_ENDPOINT: "http://example.com/v1/systemone" },
    { PIJEV_JEV_ENDPOINT: "https://secret:password@example.com/v1/systemone" },
  ]) assert.throws(() => loadConfig(env), { name: "Error" });
  const config = loadConfig({ PIJEV_MODE: "observe", PIJEV_HOME: "~/custom", PIJEV_JEV_TIMEOUT_MS: "500" }, "/users/tester");
  assert.equal(config.mode, "observe");
  assert.equal(config.home, "/users/tester/custom");
  assert.equal(config.timeoutMs, 500);
});

test("selects the matching Jev provider, credentials, model and endpoint", () => {
  const gateway = loadConfig({ AI_GATEWAY_API_KEY: "gateway-fixture" });
  assert.equal(gateway.provider, "vercel");
  assert.equal(gateway.apiKey, "gateway-fixture");
  assert.equal(gateway.model, "typesafe-ai/jev");
  assert.equal(gateway.endpoint, "https://ai-gateway.vercel.sh/v4/ai");
  const direct = loadConfig({ AI_GATEWAY_API_KEY: "gateway-fixture", TYPESAFE_API_KEY: "direct-fixture" });
  assert.equal(direct.provider, "typesafe");
  assert.equal(direct.apiKey, "direct-fixture");
  const explicit = loadConfig({ PIJEV_JEV_PROVIDER: "vercel", TYPESAFE_API_KEY: "never-send-to-gateway" });
  assert.equal(explicit.apiKey, undefined);
  assert.throws(() => loadConfig({ PIJEV_JEV_PROVIDER: "unknown" }));
});

// A broad automatic read is explicit opt-in until whole-task benefits are measured.
test("source briefing is experimental, disabled by default, and validates its flag", () => {
  assert.equal(loadConfig({}).sourceBriefing, false);
  assert.equal(loadConfig({ PIJEV_SOURCE_BRIEFING: "1" }).sourceBriefing, true);
  assert.equal(loadConfig({ PIJEV_SOURCE_BRIEFING: "0" }).sourceBriefing, false);
  assert.throws(() => loadConfig({ PIJEV_SOURCE_BRIEFING: "yes" }));
});
