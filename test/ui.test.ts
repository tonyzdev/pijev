import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createPijevExtension } from "../src/extension.js";
import { loadConfig } from "../src/config.js";
import { preferPijevSearch } from "../src/ui.js";

test("expanded search rendering removes terminal commands while retaining readable lines", async () => {
  const registered: ToolDefinition[] = [];
  const api = { on() {}, registerCommand() {}, registerTool(tool: ToolDefinition) { registered.push(tool); } } as unknown as ExtensionAPI;
  await createPijevExtension(loadConfig({}))(api);
  const theme = { fg: (_: string, text: string) => text } as Theme;
  const tool = registered.find((entry) => entry.name === "pijev_search")!;
  const result = tool.renderResult!({ content: [{ type: "text", text: "src/a.ts:1\n1: before\x1b]52;c;aGFja2Vk\x07\x1b[2Jafter\n2: safe" }], details: {} }, { expanded: true, isPartial: false }, theme, {} as never);
  const rendered = result.render(80).join("\n");
  assert.ok(!rendered.includes("\x1b]52") && !rendered.includes("\x1b[2J"));
  assert.ok(!rendered.includes("aGFja2Vk"));
  assert.match(rendered, /1: beforeafter/);
  assert.match(rendered, /2: safe/);
});

test("preferPijevSearch rewrites only Pi's bash-search guidance and leaves other prompts alone", () => {
  const pi = "Available tools:\n- bash: Execute bash commands (ls, grep, find, etc.)\n- pijev_search: Find and rank\nGuidelines:\n- Use bash for file operations like ls, rg, find\n- Be concise";
  const out = preferPijevSearch(pi);
  assert.ok(!out.includes("Use bash for file operations like ls, rg, find"));
  assert.ok(out.includes("call pijev_search first"));
  assert.ok(out.includes("- bash: Execute bash commands (ls, find, running tests, etc.)"));
  assert.ok(out.includes("- Be concise"));
  assert.equal(preferPijevSearch("custom prompt without those lines"), "custom prompt without those lines");
});
