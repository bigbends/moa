import type { MediaType } from "@moa/shared";

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/** Korean age rating badge text: "ALL" -> "전체". */
export const certLabel = (value?: string) => !value ? undefined : /^all$/i.test(value) ? "전체" : value;

export const TYPE_LABEL: Record<MediaType, string> = { movie: "영화", series: "시리즈", anime: "애니" };

/** 5400 -> "1시간 30분", 840 -> "14분". */
export function humanDuration(seconds?: number): string {
  if (!seconds || seconds < 60) return seconds ? "1분 미만" : "";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ""}` : `${minutes}분`;
}

/** 754 -> "12:34", 3754 -> "1:02:34". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function fileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Stable pleasant gradient for artwork placeholders. */
export function artGradient(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(150deg, hsl(${hue} 32% 26%), hsl(${(hue + 40) % 360} 28% 12%))`;
}

export const PROFILE_COLOR: Record<string, string> = {
  red: "linear-gradient(135deg,#ff5f6d,#c3203b)",
  blue: "linear-gradient(135deg,#4f8cff,#2643c4)",
  green: "linear-gradient(135deg,#3fd28b,#11845a)",
  amber: "linear-gradient(135deg,#ffc24b,#e0731d)",
  violet: "linear-gradient(135deg,#9a85ff,#5b3fe0)",
  teal: "linear-gradient(135deg,#3fd7d0,#0f7f9a)"
};

/** Source titles sometimes repeat themselves ("1화 .  1화"); show the clean part. */
export function episodeTitle(title: string) {
  const t = title.trim().replace(/\s+/g, " ");
  const dup = /^(.+?)\s*[.·:-]\s*\1$/.exec(t);
  return dup ? dup[1] : t;
}
