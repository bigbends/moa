import { useEffect } from "react";

const SETTLE_MS = 500;

/** What is worth searching for: no half-typed Hangul jamo at the end ("거ㅇ"), no stray spaces. */
export function settledQuery(raw: string) {
  return raw.replace(/[ㄱ-ㆎ]+$/u, "").trim().replace(/\s+/g, " ");
}

/**
 * Commits the query once typing pauses, so each source is searched for the finished words rather than every
 * keystroke. One-character queries wait for Enter; an unchanged settled query (e.g. a trailing space) is not resent.
 */
export function useSettledQuery(value: string, committed: string, commit: (query: string) => void) {
  useEffect(() => {
    const query = settledQuery(value);
    if (query === committed || query.length === 1) return;
    const timer = setTimeout(() => commit(query), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [value, committed]); // eslint-disable-line react-hooks/exhaustive-deps
}
