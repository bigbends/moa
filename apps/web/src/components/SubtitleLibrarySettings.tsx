import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import type { SavedSubtitle } from '@moa/shared';
import { api, ApiError } from '../lib/api';
import { fileSize } from '../lib/format';
import { exportSubtitle } from '../player/subtitle-files';
import { IconButton, Skeleton } from './ui';

const key = ['admin', 'subtitles'];
const url = (row: SavedSubtitle) => `/admin/subtitles/${row.source}/${encodeURIComponent(row.id)}`;

export function SubtitleLibrarySettings() {
  const client = useQueryClient();
  const subtitles = useQuery({ queryKey: key, queryFn: ({ signal }) => api<SavedSubtitle[]>('/admin/subtitles', { signal }) });
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (row: SavedSubtitle) => api(url(row), { method: 'DELETE' }),
    onSuccess: () => { setError(null); void client.invalidateQueries({ queryKey: key }); },
    onError: error => setError(error instanceof ApiError && error.code === 'translation-running' ? '번역 중인 자막은 작업이 끝난 뒤 삭제해 주세요.' : '자막을 삭제하지 못했어요. 다시 시도해 주세요.')
  });
  const rows = (subtitles.data ?? []).filter(row => `${row.name} ${row.title} ${row.profile ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="settings-group" id="saved-subtitles">
    <h2>저장한 자막</h2>
    <div className="settings-card">
      <div className="setting setting-stack">
        <div><b>{subtitles.data?.length ?? 0}개 · {fileSize((subtitles.data ?? []).reduce((sum, row) => sum + row.bytes, 0))}</b><small>AI 번역·온라인·직접 가져온 자막을 내려받거나 삭제할 수 있어요.</small></div>
        <label className="field"><input type="search" aria-label="저장한 자막 검색" placeholder="파일·작품·프로필 이름" value={search} onChange={event => setSearch(event.target.value)} /></label>
      </div>
      {subtitles.isPending ? <Skeleton className="folder-sk" /> : subtitles.isError ? <p className="settings-error" role="alert">저장한 자막을 불러오지 못했어요. <button className="text-btn" onClick={() => void subtitles.refetch()}>다시 시도</button></p> : rows.length ? rows.map(row => <div className="setting" key={`${row.source}:${row.id}`}>
        <div><b>{row.name}</b><small>{row.title}</small><small>{row.source === 'translation' ? `AI 번역${row.complete ? '' : ' · 일부'}` : row.source === 'online' ? '온라인 자막' : `가져온 자막 · ${row.profile}`} · {row.format.toUpperCase()} · {fileSize(row.bytes)}</small></div>
        <span className="network-actions">
        <IconButton label={`${row.name} 다운로드`} onClick={() => void exportSubtitle({ id: row.id, label: row.name, source: row.source, format: row.format, url: `/api${url(row)}/content` }, row.source === 'upload' ? row.name.replace(/\.[^.]+$/, '') : row.title).catch(() => setError('자막을 내려받지 못했어요. 다시 시도해 주세요.'))}><Download size={18} /></IconButton>
        <IconButton label={`${row.name} 삭제`} disabled={remove.isPending} onClick={() => { if (confirm(`‘${row.name}’ 자막을 서버에서 삭제할까요? 삭제한 자막은 복구할 수 없어요.`)) remove.mutate(row); }}><Trash2 size={18} /></IconButton>
        </span>
      </div>) : <p className="settings-hint">{search ? '검색 결과가 없어요.' : '저장한 자막이 없어요.'}</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
    </div>
  </section>;
}
