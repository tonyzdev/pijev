import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { setImmediate } from "node:timers/promises";
import { minimatch } from "minimatch";
import type { CodeCandidate } from "./search.js";

interface DiscoveryOptions {
  cwd: string; query: string; path?: string; glob?: string; signal?: AbortSignal;
  /** Read budgets, overridable so tests can exercise the bounds cheaply. */
  maxFiles?: number; maxReadBytes?: number; shortlist?: number; proseShare?: number;
}
interface Window { path: string; line: number; startLine: number; excerpt: string; terms: Set<string>; score: number; tie: number }
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_READ_BYTES = 48 * 1024 * 1024;
// Ranking is per file, so the shortlist is the recall ceiling Jev inherits.
const SHORTLIST = 100;
const MAX_EXCERPT_BYTES = 1800;
const MAX_OUTLINE_BYTES = 1200;
const READ_DEADLINE_MS = 8000;
// Keep these aligned with literal search. Positive caller globs never reach rg.
const excluded = ["node_modules", "vendor", "dist", "build", "coverage", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.pem", "*.key", "credentials*", "*.env", ".env*"];
const stopWords = new Set("a an and are as at be by can code do does for from happen how i in is it of on or should that the their then these this to using was what when where which who why will with would".split(" "));

function excludedPath(path: string): boolean {
  return path.split(sep).some((part) => part.startsWith(".") || excluded.some((pattern) => minimatch(part, pattern, { dot: true })));
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** Identifier boundaries plus literal Han bigrams; no invented translations. */
function tokens(text: string): Set<string> {
  const result = new Set<string>();
  const split = text.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").toLowerCase();
  for (const word of split.match(/[a-z][a-z\d]*|\p{Script=Han}+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(word)) {
      if (word.length === 1) result.add(word);
      for (let i = 0; i < word.length - 1; i++) result.add(word.slice(i, i + 2));
    } else if (word.length > 1 && !stopWords.has(word)) {
      result.add(word);
    }
  }
  return result;
}

/** Term frequencies for BM25. `tokens` deliberately returns a set for overlap
 * checks; saturation and length normalization need the counts it discards. */
function tokenCounts(text: string): { counts: Map<string, number>; length: number } {
  const counts = new Map<string, number>();
  let length = 0;
  const add = (term: string) => { counts.set(term, (counts.get(term) ?? 0) + 1); length++; };
  const split = text.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2").toLowerCase();
  for (const word of split.match(/[a-z][a-z\d]*|\p{Script=Han}+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(word)) {
      if (word.length === 1) add(word);
      for (let i = 0; i < word.length - 1; i++) add(word.slice(i, i + 2));
    } else if (word.length > 1 && !stopWords.has(word)) {
      add(word);
    }
  }
  return { counts, length };
}

function overlap(text: string, query: Set<string>): Set<string> {
  return new Set([...tokens(text)].filter((term) => query.has(term)));
}

async function enumerate(root: string, target: string, options: DiscoveryOptions): Promise<{ paths: string[]; truncated: boolean }> {
  const args = ["--no-config", "--files", "--null", "--sort", "path"];
  for (const pattern of excluded) args.push("--glob", `!${pattern}`);
  args.push("--", ".");
  return new Promise((fulfill, reject) => {
    const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const paths: string[] = [];
    let pending = "";
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let startError = false;
    // SIGKILL guarantees bounded termination even if a replaced rg ignores TERM.
    const cancel = () => { child.kill("SIGKILL"); };
    const timer = setTimeout(() => { timedOut = true; cancel(); }, 5000);
    options.signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (truncated) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_000_000) { truncated = true; cancel(); return; }
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\0")) >= 0) {
        const path = relative(root, resolve(root, pending.slice(0, end)));
        pending = pending.slice(end + 1);
        if (!inside(target, resolve(root, path)) || excludedPath(path)) continue;
        if (options.glob && !minimatch(path.split(sep).join("/"), options.glob, { matchBase: true })) continue;
        if (paths.length === (options.maxFiles ?? MAX_FILES)) { truncated = true; cancel(); break; }
        paths.push(path);
      }
    });
    child.stderr.resume();
    child.once("error", (error: NodeJS.ErrnoException) => {
      startError = true;
      reject(new Error(error.code === "ENOENT" ? "ripgrep is required. Install rg, then retry pijev_search." : "Unable to start source discovery."));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (options.signal?.aborted) reject(new Error("Source discovery aborted."));
      else if (timedOut) reject(new Error("Source discovery timed out; narrow the source directory."));
      else if (startError || (!truncated && code !== 0 && code !== 1)) reject(new Error("Source discovery failed; check path access."));
      else fulfill({ paths, truncated });
    });
    if (options.signal?.aborted) cancel();
  });
}

/** Check every component, since O_NOFOLLOW alone protects only the final file. */
async function noSymlinks(root: string, path: string): Promise<boolean> {
  let current = root;
  for (const part of path.split(sep)) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) return false;
  }
  return true;
}

function prefixBytes(text: string, max: number): string {
  const buffer = Buffer.from(text);
  if (buffer.length <= max) return text;
  let end = max;
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

/** At most four real windows per file; sample across the body when lexical clues fail. */
function windows(path: string, source: string, query: Set<string>, queryText: string): { items: Window[]; truncated: boolean } {
  const lines = source.split("\n");
  const pathTerms = overlap(path, query);
  const lineTerms = lines.map((line) => overlap(line, query));
  const ranked = lines.map((_, index) => index).filter((index) => lineTerms[index]!.size > 0)
    .sort((a, b) => lineTerms[b]!.size - lineTerms[a]!.size || a - b);
  const anchors = lines.map((line, index) => ({ line, index })).filter(({ line }) => /\b(function|class|def|fn|func|export|async)\b|^\s*(?:[\w<>]+\s+)?[\w]+\s*\([^;]*\)\s*\{/.test(line)).map(({ index }) => index);
  const body = anchors.length ? anchors : lines.map((_, i) => i).filter((i) => lines[i]!.trim());
  for (const fraction of [0.5, 0.2, 0.8, 0]) {
    const index = body[Math.min(body.length - 1, Math.floor(body.length * fraction))];
    if (index !== undefined) ranked.push(index);
  }
  const items: Window[] = [];
  const covered = new Set<number>();
  let clipped = false;
  for (const index of ranked) {
    if (items.length === 4) break;
    if (covered.has(index)) continue;
    // Start with the anchor so a long preceding line cannot hide the evidence.
    let start = index;
    let end = index + 1;
    let excerpt = prefixBytes(lines[index]!, MAX_EXCERPT_BYTES);
    const clippedAnchor = excerpt !== lines[index];
    if (clippedAnchor) clipped = true;
    for (let distance = 1; distance <= 12; distance++) {
      const next = lines[end];
      if (!clippedAnchor && next !== undefined && Buffer.byteLength(`${excerpt}\n${next}`) <= MAX_EXCERPT_BYTES) { excerpt += `\n${next}`; end++; }
      const previous = lines[start - 1];
      if (previous !== undefined && Buffer.byteLength(`${previous}\n${excerpt}`) <= MAX_EXCERPT_BYTES) { excerpt = `${previous}\n${excerpt}`; start--; }
    }
    const terms = overlap(excerpt, query);
    for (const term of pathTerms) terms.add(term);
    const score = lineTerms[index]!.size * 4 + terms.size * 2 + pathTerms.size;
    items.push({ path, line: index + 1, startLine: start + 1, excerpt, terms, score, tie: hash(`${queryText}\0${path}\0${index}`) });
    for (let i = start; i < end; i++) covered.add(i);
  }
  return { items, truncated: clipped || lines.some((line, i) => line.trim() && !covered.has(i)) };
}

/** Prose repeats natural-language query words far more densely than code does,
 * so unstratified BM25 hands the whole shortlist to documentation. Reserving
 * most slots for source keeps both kinds in front of the ranker instead of
 * excluding either one. Measured on SWE-bench Verified, 0.1 ranked the gold
 * file at least as well as 0.2 on every instance and better on four; a share of
 * zero scored marginally higher still but would make a documentation question
 * unanswerable, so it is rejected by design rather than by the benchmark. */
const PROSE_SHARE = 0.1;
function prose(path: string): boolean {
  return /\.(?:txt|md|rst|adoc|po|pot|html?|tex)$/i.test(path) || path.split(sep).includes("docs");
}

/** Okapi BM25 over whole files: idf weighting and length normalization are what
 * keep one decisive rare identifier ahead of a file that merely repeats common
 * query words. Raw term-overlap counts invert exactly that ordering. */
function bm25(query: Set<string>, documents: { path: string; terms: Map<string, number>; length: number }[], k1 = 1.2, b = 0.75): number[] {
  const total = documents.length;
  const average = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, total);
  const idf = new Map<string, number>();
  for (const term of query) {
    const frequency = documents.reduce((count, document) => count + (document.terms.has(term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
  }
  return documents.map((document) => {
    let score = 0;
    for (const term of query) {
      const frequency = document.terms.get(term);
      if (frequency) score += idf.get(term)! * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * document.length / average));
    }
    // A path hit is evidence about the file as a whole, not about one line.
    return score + overlap(document.path, query).size * 1.5;
  });
}

/** Compact whole-file evidence for ranking. Real excerpts remain what the model
 * receives; this is only what the decision service scores. */
function outline(path: string, source: string, query: Set<string>): string {
  const lines = source.split("\n");
  const head: string[] = [];
  for (const line of lines.slice(0, 60)) {
    if (line.trim() && /^\s*(?:import|from|package|using|#include|\/\/|#)/.test(line)) head.push(line.trim());
    if (head.length === 6) break;
  }
  const definitions: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,4}(?:export\s+)?(?:async\s+)?(?:function|class|def|fn|func|interface|type|const|struct|impl)\s+[\w<>$]/.test(lines[i]!)) definitions.push(`${i + 1}: ${lines[i]!.trim().slice(0, 140)}`);
    if (definitions.length === 48) break;
  }
  const hits: string[] = [];
  for (let i = 0; i < lines.length && hits.length < 8; i++) if (overlap(lines[i]!, query).size) hits.push(`${i + 1}: ${lines[i]!.trim().slice(0, 140)}`);
  return prefixBytes([`# ${path} (${lines.length} lines)`, ...head, "## definitions", ...definitions, "## query matches", ...hits].join("\n"), MAX_OUTLINE_BYTES);
}

/** Bounded lexical discovery only. Scores select real excerpts, never generated summaries. */
export async function discoverCode(options: DiscoveryOptions): Promise<{ candidates: CodeCandidate[]; truncated: boolean; filesScanned: number }> {
  options.signal?.throwIfAborted();
  if (typeof options.query !== "string" || !options.query.trim() || options.query.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(options.query)) throw new Error("Discovery query must contain 1–2000 characters without control characters.");
  if (options.path !== undefined && (options.path.length > 4096 || /[\x00-\x1f]/.test(options.path))) throw new Error("Source path must be at most 4096 characters without control characters.");
  if (options.glob !== undefined && (options.glob.length > 500 || /[\x00-\x1f]/.test(options.glob))) throw new Error("File glob must be at most 500 characters without control characters.");
  const root = await realpath(options.cwd);
  const lexicalTarget = resolve(root, options.path ?? ".");
  const target = await realpath(lexicalTarget);
  if (!inside(root, lexicalTarget) || !inside(root, target)) throw new Error("Source path must remain inside the current working directory.");
  if ((relative(root, lexicalTarget) && excludedPath(relative(root, lexicalTarget))) || (relative(root, target) && excludedPath(relative(root, target))) || !(await stat(target)).isDirectory()) throw new Error("Discovery excludes hidden files, credentials and generated/dependency directories; choose a source directory.");
  options.signal?.throwIfAborted();
  const enumeration = await enumerate(root, target, options);
  const query = tokens(options.query);
  // Hash ties spread the read budget across names, even without lexical overlap.
  enumeration.paths.sort((a, b) => overlap(b, query).size - overlap(a, query).size || hash(`${options.query}\0${a}`) - hash(`${options.query}\0${b}`) || a.localeCompare(b));
  const maxReadBytes = options.maxReadBytes ?? MAX_READ_BYTES;
  const shortlistSize = options.shortlist ?? SHORTLIST;
  let truncated = enumeration.truncated;
  let bytesRead = 0;
  let filesScanned = 0;
  const deadline = Date.now() + READ_DEADLINE_MS;
  const sources: { path: string; source: string }[] = [];
  for (const path of enumeration.paths) {
    options.signal?.throwIfAborted();
    if (bytesRead === maxReadBytes || Date.now() > deadline) { truncated = true; break; }
    const absolute = resolve(root, path);
    try {
      if (!(await noSymlinks(root, path))) { truncated = true; continue; }
      const canonical = await realpath(absolute);
      if (canonical !== absolute || !inside(target, canonical) || excludedPath(relative(root, canonical))) { truncated = true; continue; }
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await handle.stat();
        const current = await lstat(absolute);
        if (!info.isFile() || current.isSymbolicLink() || info.ino !== current.ino || info.dev !== current.dev || !(await noSymlinks(root, path))) { truncated = true; continue; }
        if (info.size > MAX_FILE_BYTES) { truncated = true; continue; }
        const size = Math.min(info.size, maxReadBytes - bytesRead);
        if (size < info.size) truncated = true;
        const buffer = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          options.signal?.throwIfAborted();
          const read = await handle.read(buffer, offset, Math.min(64 * 1024, size - offset), offset);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        bytesRead += offset;
        filesScanned++;
        options.signal?.throwIfAborted();
        if (offset < info.size || (await handle.stat()).size !== info.size) truncated = true;
        const data = buffer.subarray(0, offset);
        if (data.includes(0)) continue;
        let source: string;
        try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); } catch { truncated = true; continue; }
        if (!source.trim()) continue;
        sources.push({ path, source });
      } finally { await handle.close(); }
    } catch {
      options.signal?.throwIfAborted();
      // Files may disappear or become unreadable while an editor changes them.
      truncated = true;
    }
  }
  options.signal?.throwIfAborted();
  if (!sources.length) return { candidates: [], truncated, filesScanned };
  // Score whole files first: a file is the unit that gets read and edited, and
  // splitting it into competing windows scatters the evidence for that decision.
  const documents = sources.map(({ path, source }) => {
    const { counts, length } = tokenCounts(source);
    return { path, terms: counts, length: Math.max(1, length) };
  });
  const scores = bm25(query, documents);
  const order = sources.map((_, index) => index)
    .sort((a, b) => scores[b]! - scores[a]! || hash(`${options.query}\0${sources[a]!.path}`) - hash(`${options.query}\0${sources[b]!.path}`) || sources[a]!.path.localeCompare(sources[b]!.path));
  const proseBudget = Math.round(shortlistSize * (options.proseShare ?? PROSE_SHARE));
  const source = order.filter((index) => !prose(sources[index]!.path));
  const written = order.filter((index) => prose(sources[index]!.path));
  const keptProse = written.slice(0, Math.max(proseBudget, shortlistSize - source.length));
  const kept = new Set([...source.slice(0, shortlistSize - keptProse.length), ...keptProse]);
  // Restore the single BM25 order so the unranked fallback stays meaningful.
  const shortlist = order.filter((index) => kept.has(index));
  if (shortlist.length < order.length) truncated = true;
  const candidates: CodeCandidate[] = [];
  for (const index of shortlist) {
    await setImmediate(undefined, { signal: options.signal });
    const { path, source } = sources[index]!;
    const result = windows(path, source, query, options.query);
    const best = result.items[0];
    if (!best) continue;
    truncated ||= result.truncated;
    candidates.push({ id: `c${candidates.length}`, path, line: best.line, startLine: best.startLine, excerpt: best.excerpt, outline: outline(path, source, query) });
  }
  return { candidates, truncated, filesScanned };
}
