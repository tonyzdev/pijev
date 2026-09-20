import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { minimatch } from "minimatch";

/** `outline` is whole-file evidence used only for ranking; `excerpt` is the real
 * source the model receives. Literal pattern search supplies no outline. */
export interface CodeCandidate { id: string; path: string; line: number; startLine: number; excerpt: string; outline?: string; relevance?: number }
export interface SearchOptions { cwd: string; patterns: string[]; path?: string; glob?: string; maxCandidates?: number; signal?: AbortSignal }
export interface SearchResult { candidates: CodeCandidate[]; truncated: boolean }
const excluded = ["node_modules", "vendor", "dist", "build", "coverage", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.pem", "*.key", "credentials*", "*.env", ".env*"];

function excludedPath(path: string): boolean {
  return path.split(sep).some((part) => part.startsWith(".") || excluded.some((pattern) => minimatch(part, pattern, { dot: true })));
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Exact lexical retrieval; Jev can reorder these excerpts but never synthesizes them. */
export async function retrieveCode(options: SearchOptions): Promise<SearchResult> {
  options.signal?.throwIfAborted();
  if (!options.patterns.length || options.patterns.length > 8 || options.patterns.some((p) => !p.trim() || p.length > 200 || p.includes("\0") || p.includes("\n"))) {
    throw new Error("Supply 1–8 non-empty literal patterns, at most 200 characters each.");
  }
  const root = await realpath(options.cwd);
  const target = await realpath(resolve(root, options.path ?? "."));
  if (!inside(root, target)) throw new Error("Search path must remain inside the current working directory.");
  const relTarget = relative(root, target);
  if ((relTarget && excludedPath(relTarget)) || !(await stat(target)).isDirectory()) {
    throw new Error("Search excludes hidden files, credentials and generated/dependency directories; choose a source directory.");
  }
  if (options.glob && (options.glob.length > 500 || /[\x00-\x1f]/.test(options.glob))) throw new Error("File glob must be at most 500 characters without control characters.");
  const limit = Math.max(1, Math.min(40, options.maxCandidates ?? 32));
  const args = ["--no-config", "--json", "--line-number", "--fixed-strings", "--sort", "path", "--max-filesize", "256K", "--color", "never"];
  for (const pattern of excluded) args.push("--glob", `!${pattern}`);
  for (const pattern of options.patterns) args.push("--regexp", pattern);
  // Always traverse from the root: explicit rg targets and positive globs can
  // override ignore rules. Caller path/glob only narrow the returned matches.
  args.push("--", ".");
  const matches: Array<{ path: string; line: number }> = [];
  let truncated = false;
  await new Promise<void>((fulfill, reject) => {
    const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let pending = "";
    let bytes = 0;
    let timedOut = false;
    let failed = false;
    const cancel = () => child.kill("SIGTERM");
    const timer = setTimeout(() => { timedOut = true; cancel(); }, 5000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    const stopAtLimit = () => { truncated = true; cancel(); };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (truncated) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_000_000) { stopAtLimit(); return; }
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const entry = JSON.parse(line) as { type?: string; data?: { path?: { text?: string }; line_number?: number } };
          if (entry.type !== "match" || !entry.data?.path?.text || !Number.isSafeInteger(entry.data.line_number)) continue;
          const candidatePath = relative(root, resolve(root, entry.data.path.text));
          if (excludedPath(candidatePath) || !inside(target, resolve(root, candidatePath))) continue;
          if (options.glob && !minimatch(candidatePath.split(sep).join("/"), options.glob, { matchBase: true })) continue;
          if (matches.length >= limit) { stopAtLimit(); break; }
          matches.push({ path: entry.data.path.text, line: entry.data.line_number! });
        } catch { failed = true; cancel(); break; }
      }
    });
    child.stderr.resume();
    child.once("error", (error: NodeJS.ErrnoException) => {
      failed = true;
      reject(new Error(error.code === "ENOENT" ? "ripgrep is required. Install rg, then retry pijev_search." : "Unable to start source search."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (options.signal?.aborted) reject(new Error("Search aborted."));
      else if (timedOut) reject(new Error("Source search timed out; narrow the path or patterns."));
      else if (failed || (!truncated && code !== 0 && code !== 1)) reject(new Error("Source search failed; check path access and glob syntax."));
      else fulfill();
    });
    if (options.signal?.aborted) cancel();
  });
  const candidates: CodeCandidate[] = [];
  const files = new Map<string, string[]>();
  for (const match of matches) {
    options.signal?.throwIfAborted();
    const absolute = await realpath(resolve(root, match.path)).catch(() => undefined);
    if (!absolute || !inside(target, absolute) || excludedPath(relative(root, absolute))) continue;
    let lines = files.get(absolute);
    if (!lines) {
      const info = await stat(absolute).catch(() => undefined);
      if (!info?.isFile() || info.size > 262_144) continue;
      lines = (await readFile(absolute, "utf8")).split("\n");
      files.set(absolute, lines);
    }
    const startLine = Math.max(1, match.line - 2);
    const excerpt = lines.slice(startLine - 1, match.line + 2).map((line) => line.length > 350 ? `${line.slice(0, 350)} … [line clipped]` : line).join("\n");
    candidates.push({ id: `c${candidates.length}`, path: relative(root, absolute), line: match.line, startLine, excerpt });
  }
  return { candidates, truncated };
}
