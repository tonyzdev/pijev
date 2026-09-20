import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { DecisionMode, PijevConfig } from "./config.js";
import type { DecisionJournal, DecisionRecord } from "./telemetry.js";

export const VERSION = "0.1.0";
export function cleanDisplayText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ");
}
export function cleanText(text: string): string { return cleanDisplayText(text).replace(/\n/g, " "); }

export function header(theme: Theme, width: number, config: PijevConfig): string[] {
  const rows = [
    "",
    `  ${theme.fg("accent", theme.bold("PiJev"))}  ${theme.fg("dim", `v${VERSION}`)}   ${theme.fg("muted", "Fast judgment. Deliberate code.")}`,
    `  ${theme.fg("dim", "Jev decisions · Pi execution · your coding model")}`,
    "",
    `  ${theme.fg("accent", "/pijev")} status & modes    ${theme.fg("accent", "/model")} coding model    ${theme.fg("accent", "/login")} connect`,
    ...(config.apiKey ? [] : [`  ${theme.fg("warning", "Jev not connected")} ${theme.fg("dim", `Set ${config.provider === "vercel" ? "AI_GATEWAY_API_KEY" : "TYPESAFE_API_KEY"} before launch.`)}`]),
    "",
  ];
  return rows.map((line) => truncateToWidth(line, width));
}

export function statusText(config: PijevConfig, mode: DecisionMode, journal: DecisionJournal, last?: DecisionRecord): string {
  if (mode === "off") return "PiJev · Jev off";
  if (!config.apiKey) return "PiJev · Jev not connected";
  const stats = journal.summary();
  const tail = last?.status === "fallback" ? ` · fallback: ${last.reason}` : last ? ` · ${last.latencyMs}ms${last.cached ? " cached" : ""}` : "";
  return `PiJev · ${config.provider} · ${mode} · ${stats.calls} decisions${tail}`;
}

export function formatDecisions(records: DecisionRecord[]): string {
  if (!records.length) return "No Jev decisions recorded yet.";
  return records.map((record) => cleanText(`${record.at.slice(11, 19)}  ${record.mode.padEnd(7)} ${record.kind.padEnd(15)} ${record.status === "fallback" ? `fallback:${record.reason}` : record.cached ? "cached" : "ok"}  ${record.latencyMs}ms${record.sessionId ? `  session=${record.sessionId}` : ""}${record.userMessageId ? `  user=${record.userMessageId}` : ""}`)).join("\n");
}

/** Pi's default prompt tells the model to search with bash rg before it ever sees pijev_search.
 * Rewrite only those exact lines; an unrecognised prompt is left untouched. */
export function preferPijevSearch(systemPrompt: string): string {
  return systemPrompt
    .replace("- bash: Execute bash commands (ls, grep, find, etc.)", "- bash: Execute bash commands (ls, find, running tests, etc.)")
    .replace("- Use bash for file operations like ls, rg, find", "- To find code, call pijev_search first with a concrete question; use bash rg/grep only to verify or expand what it returned");
}
