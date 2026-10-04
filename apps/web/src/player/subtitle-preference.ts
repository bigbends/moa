import { currentProfileId } from '../lib/api';

const key = (mediaId: string) => `moa.subtitlesOff:${JSON.stringify([currentProfileId(), mediaId])}`;
// Preserve the choice for this app session even when browser storage is unavailable.
const fallback = new Map<string, boolean>();
export function subtitlesOffForTitle(mediaId: string): boolean {
  const id = key(mediaId);
  if (fallback.has(id)) return fallback.get(id)!;
  try { return localStorage.getItem(id) === '1'; } catch { return fallback.get(id) ?? false; }
}
export function rememberSubtitlesOff(mediaId: string, off: boolean) {
  const id = key(mediaId);
  try {
    if (off) localStorage.setItem(id, '1'); else localStorage.removeItem(id);
    fallback.delete(id);
  } catch { fallback.set(id, off); }
}

/** Subtitle timing offset (seconds) remembered per profile and title; release groups keep the same timing across episodes. */
const offsetKey = (mediaId: string) => `moa.subtitleOffset:${JSON.stringify([currentProfileId(), mediaId])}`;
export function subtitleOffsetForTitle(mediaId: string): number {
  try { const value = Number(localStorage.getItem(offsetKey(mediaId))); return Number.isFinite(value) ? value : 0; } catch { return 0; }
}
export function rememberSubtitleOffset(mediaId: string, seconds: number) {
  try { if (seconds) localStorage.setItem(offsetKey(mediaId), String(seconds)); else localStorage.removeItem(offsetKey(mediaId)); } catch { /* private mode */ }
}
