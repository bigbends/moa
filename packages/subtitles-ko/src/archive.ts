import yauzl, { type Entry, type ZipFile } from "yauzl";
import iconv from "iconv-lite";
import type { Readable } from "node:stream";
import { decodeSubtitleBuffer, convertSubtitle } from "./convert.js";
import { parseEpisodes, parseSeason } from "./normalize.js";

export interface ExtractOptions {
  episode: number;
  /** Optional identity validation supplied by the title-aware collector. */
  acceptFilename?: (name: string) => boolean;
  alternateEpisode?: number;
  season?: number;
  /** Only true when the post/title or attachment label established this episode. */
  allowUnnumbered?: boolean;
  maxZipBytes?: number;
  maxEntries?: number;
  signal?: AbortSignal;
}
export interface ExtractedSubtitle { filename: string; format: "ass" | "vtt"; content: string; matchedEpisode: number; exactEpisode: boolean }

export function safeZipPath(name: string): boolean {
  return !!name && !/[\x00-\x1f]/.test(name) && !/^(?:[\\/]|[A-Za-z]:)/.test(name) &&
    !name.replace(/\\/g, "/").split("/").some(part => part === "..") &&
    !name.startsWith("__MACOSX/");
}

function filenameFor(entry: Entry): string {
  const raw = entry.fileName as unknown as Buffer;
  if (entry.generalPurposeBitFlag & 0x800) return iconv.decode(raw, "utf8");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { return iconv.decode(raw, "cp949"); }
}

function rank(name: string, options: ExtractOptions): { rank: number; episode: number; exact: boolean } | undefined {
  if (options.acceptFilename?.(name) === false) return undefined;
  if (options.season && parseSeason(name) && parseSeason(name) !== options.season) return undefined;
  const episodes = parseEpisodes(name);
  if (episodes.length > 1) return undefined; // A range-labelled subtitle is not one confirmed episode.
  const choices = parseSeason(name) ? [options.episode] : [options.episode, options.alternateEpisode];
  const match = choices.find(ep => ep !== undefined && episodes.includes(ep));
  if (match === undefined && (episodes.length || !options.allowUnnumbered)) return undefined;
  const ext = name.split(".").at(-1)?.toLowerCase();
  if (!ext || !["ass", "ssa", "smi", "srt", "vtt"].includes(ext)) return undefined;
  return { rank: (match !== undefined ? 100 : 0) + (ext === "ass" || ext === "ssa" ? 5 : 0), episode: match ?? options.episode, exact: match !== undefined };
}

export async function extractSubtitleBuffer(input: Uint8Array, filename: string, options: ExtractOptions): Promise<ExtractedSubtitle | null> {
  const buf = Buffer.from(input);
  options.signal?.throwIfAborted();
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    if (options.acceptFilename?.(filename) === false) return null;
    const score = rank(filename, options);
    // Unknown filenames from cloud downloads are accepted only with a matched post/label.
    const numbers = parseEpisodes(filename);
    if (!score && (numbers.length || !options.allowUnnumbered)) return null;
    if (options.season && parseSeason(filename) && parseSeason(filename) !== options.season) return null;
    const converted = convertSubtitle(decodeSubtitleBuffer(buf));
    return { ...converted, filename, matchedEpisode: score?.episode ?? options.episode, exactEpisode: score?.exact ?? false };
  }
  const maxBytes = options.maxZipBytes ?? 40 * 1024 * 1024;
  const maxEntries = options.maxEntries ?? 300;
  const zip = await new Promise<ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, decodeStrings: false, validateEntrySizes: true }, (error, file) => error || !file ? reject(error ?? new Error("Invalid ZIP")) : resolve(file));
  });
  let activeStream: Readable | undefined;
  try {
    const selected = await new Promise<{ entry: Entry; name: string; score: NonNullable<ReturnType<typeof rank>> } | null>((resolve, reject) => {
      let total = 0, count = 0;
      const candidates: { entry: Entry; name: string; score: NonNullable<ReturnType<typeof rank>> }[] = [];
      const abort = () => { zip.close(); reject(options.signal?.reason ?? new Error("Aborted")); };
      options.signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => options.signal?.removeEventListener("abort", abort);
      zip.once("error", error => { cleanup(); reject(error); });
      zip.once("end", () => {
        cleanup();
        candidates.sort((a, b) => b.score.rank - a.score.rank || a.name.localeCompare(b.name));
        // Ambiguous unnumbered multi-file archives are not selected.
        resolve(candidates.length > 1 && !candidates[0]?.score.exact ? null : candidates[0] ?? null);
      });
      zip.on("entry", (entry: Entry) => {
        count++; total += entry.uncompressedSize;
        if (count > maxEntries || total > maxBytes || entry.uncompressedSize > maxBytes ||
            entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 250) {
          cleanup(); zip.close(); reject(new Error("ZIP exceeds entry/expansion limit")); return;
        }
        const name = filenameFor(entry);
        const symlink = (entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000;
        if (safeZipPath(name) && !symlink && !entry.isEncrypted()) {
          const score = rank(name, options);
          if (score) candidates.push({ entry, name, score });
        }
        zip.readEntry();
      });
      // Keep the in-memory ZIP open until the selected stream is read.
      zip.autoClose = false;
      if (options.signal?.aborted) abort(); else zip.readEntry();
    });
    if (!selected) return null;
    const contents = await new Promise<Buffer>((resolve, reject) => {
      zip.openReadStream(selected.entry, (error, stream) => {
        if (error || !stream) { reject(error ?? new Error("Cannot read ZIP entry")); return; }
        activeStream = stream;
        const abort = () => stream.destroy(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Aborted"));
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes || size > selected.entry.uncompressedSize) stream.destroy(new Error("ZIP actual expansion exceeds limit"));
          else chunks.push(chunk);
        });
        stream.once("error", err => { options.signal?.removeEventListener("abort", abort); reject(err); });
        stream.once("end", () => { options.signal?.removeEventListener("abort", abort); resolve(Buffer.concat(chunks, size)); });
      });
    });
    return { ...convertSubtitle(decodeSubtitleBuffer(contents)), filename: selected.name, matchedEpisode: selected.score.episode, exactEpisode: selected.score.exact };
  } finally { activeStream?.destroy(); zip.close(); }
}
