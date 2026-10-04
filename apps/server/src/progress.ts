import type { Episode, EpisodeProgress, MediaDetail, ProgressSummary } from '@moa/shared';

export function completion(position: number, duration: number) {
  return duration > 0 && (position >= duration * .9 || duration - position < 120);
}
export function playTarget(episodes: Episode[], movie = false): MediaDetail['playTarget'] {
  const sorted = [...episodes].sort((a, b) => a.season - b.season || a.number - b.number);
  if (!sorted.length) return null;
  const ongoing = sorted.filter(e => e.progress && !e.progress.completed && e.progress.position > 0)
    .sort((a, b) => b.progress!.updatedAt.localeCompare(a.progress!.updatedAt))[0];
  if (ongoing) return { episodeId: ongoing.id, position: ongoing.progress!.position, label: movie ? '이어보기' : `이어보기 S${ongoing.season}:E${ongoing.number}` };
  const latest = sorted.filter(e => e.progress).sort((a, b) => b.progress!.updatedAt.localeCompare(a.progress!.updatedAt) || b.season - a.season || b.number - a.number)[0];
  const next = latest ? sorted.slice(sorted.indexOf(latest) + 1).find(e => !e.progress?.completed) : undefined;
  const unseen = next || sorted.find(e => !e.progress?.completed);
  return { episodeId: (unseen || sorted[0]).id, position: 0, label: unseen ? '재생' : '다시 보기' };
}
export function summary(ep: Episode, progress: EpisodeProgress, movie: boolean): ProgressSummary {
  const remaining = Math.max(0, Math.ceil((progress.duration - progress.position) / 60));
  return { episodeId: ep.id, ratio: progress.duration > 0 ? Math.min(1, progress.position / progress.duration) : 0,
    label: `${movie ? '' : `S${ep.season}:E${ep.number} · `}${remaining}분 남음` };
}
