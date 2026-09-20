import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export type DecisionMode = "assist" | "observe" | "off";
export type JevProvider = "typesafe" | "vercel";
export interface PijevConfig {
  home: string;
  mode: DecisionMode;
  apiKey?: string;
  provider: JevProvider;
  model: string;
  endpoint: string;
  timeoutMs: number;
  sourceBriefing?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, home = homedir()): PijevConfig {
  const mode = env.PIJEV_MODE ?? "assist";
  if (mode !== "assist" && mode !== "observe" && mode !== "off") throw new Error("PIJEV_MODE must be assist, observe, or off.");
  const timeoutMs = Number(env.PIJEV_JEV_TIMEOUT_MS ?? 1800);
  const briefing = env.PIJEV_SOURCE_BRIEFING ?? "0";
  if (briefing !== "0" && briefing !== "1") throw new Error("PIJEV_SOURCE_BRIEFING must be 0 or 1.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30_000) throw new Error("PIJEV_JEV_TIMEOUT_MS must be between 50 and 30000.");
  const provider = env.PIJEV_JEV_PROVIDER ?? (!env.TYPESAFE_API_KEY?.trim() && env.AI_GATEWAY_API_KEY?.trim() ? "vercel" : "typesafe");
  if (provider !== "typesafe" && provider !== "vercel") throw new Error("PIJEV_JEV_PROVIDER must be typesafe or vercel.");
  const endpoint = env.PIJEV_JEV_ENDPOINT ?? (provider === "vercel" ? "https://ai-gateway.vercel.sh/v4/ai" : "https://api.typesafe.ai/v1/systemone");
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("PIJEV_JEV_ENDPOINT must be a valid HTTPS URL."); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new Error("PIJEV_JEV_ENDPOINT requires HTTPS (HTTP is allowed on loopback), without credentials, query, or fragment.");
  }
  const configuredHome = env.PIJEV_HOME ?? join(home, ".pijev", "agent");
  const expanded = configuredHome === "~" ? home : configuredHome.startsWith("~/") ? join(home, configuredHome.slice(2)) : configuredHome;
  return {
    home: isAbsolute(expanded) ? expanded : resolve(expanded),
    mode, provider, sourceBriefing: briefing === "1", apiKey: (provider === "vercel" ? env.AI_GATEWAY_API_KEY : env.TYPESAFE_API_KEY)?.trim() || undefined,
    model: env.PIJEV_JEV_MODEL ?? (provider === "vercel" ? "typesafe-ai/jev" : "jev-latest"), endpoint: url.toString(), timeoutMs,
  };
}
