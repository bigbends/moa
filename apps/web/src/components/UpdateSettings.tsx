import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateStatus } from '@moa/shared';
import { api, ApiError } from '../lib/api';
import { Button, ConfirmDialog, Skeleton } from './ui';

const key = ['admin', 'updates'];
const states: Record<UpdateStatus['state'], string> = {
  idle: '확인 전', checking: '업데이트 확인 중…', updating: '업데이트 중…', current: '최신 상태', available: '업데이트 가능', blocked: '호스트 확인 필요', failed: '업데이트 실패', 'restart-required': '서버 재시작 필요'
};
const errors: Record<string, string> = {
  'updater-unavailable': '호스트 업데이트 도구에 연결하지 못했어요.',
  'update-dirty': '수정한 파일을 커밋하거나 정리한 뒤 다시 확인해 주세요.',
  'update-diverged': '현재 브랜치와 원격 기록이 갈라졌어요. 호스트에서 먼저 병합해 주세요.',
  'update-deployment-diverged': '실행 중인 이미지가 현재 소스보다 앞서거나 기록이 달라요. 호스트에서 배포 브랜치를 확인해 주세요.',
  'update-version-unknown': '실행 중인 이미지에 버전 정보가 없어요. 설정 안내에 따라 커밋 정보를 포함해 한 번 빌드해 주세요.',
  'update-no-upstream': '현재 Git 브랜치의 추적 브랜치를 설정해 주세요.',
  'update-not-installed': '업데이트할 Git 또는 Docker Compose 설치를 찾지 못했어요.',
  'update-git-failed': '원격 Git 저장소와 접근 권한을 확인해 주세요.',
  'update-docker-failed': 'Docker 상태와 이미지 접근 권한을 확인해 주세요.',
  'update-build-failed': '빌드하지 못했어요. 호스트 환경을 확인하고 다시 시도해 주세요.',
  'update-restart-failed': '서버를 재시작하지 못했어요. 호스트의 서비스 설정을 확인해 주세요.',
  'update-busy': '다른 업데이트 작업이 진행 중이에요.',
  'update-not-available': '업데이트 상태가 바뀌었어요. 다시 확인해 주세요.'
};
const revision = (value: string) => value === 'unknown' ? '알 수 없음' : value.replace(/^sha256:/, '').slice(0, 12);

export function UpdateSettings() {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const status = useQuery({ queryKey: key, queryFn: () => api<UpdateStatus>('/admin/updates'), refetchInterval: 3000 });
  const action = useMutation({
    mutationFn: (name: 'check' | 'apply') => api<UpdateStatus>(`/admin/updates/${name}`, { method: 'POST', body: {} }),
    onSuccess: data => { client.setQueryData(key, data); setConfirm(false); },
    onError: () => { void client.invalidateQueries({ queryKey: key }); }
  });
  const data = status.data;
  const busy = action.isPending || data?.state === 'checking' || data?.state === 'updating';
  const error = action.error instanceof ApiError ? action.error.code : action.error ? 'update-failed' : data?.error;
  return <section className="settings-group" id="updates">
    <h2>업데이트</h2>
    <div className="settings-card">
      {!data ? status.isPending ? <Skeleton className="folder-sk" /> : <div className="setting"><p className="settings-error" role="alert">업데이트 정보를 불러오지 못했어요.</p><Button onClick={() => void status.refetch()}>다시 시도</Button></div> : <>
        <div className="setting"><div><b>{data.mode === 'docker' ? 'Docker' : data.mode === 'git' ? 'Git' : '서버'} 업데이트</b><small>현재 {revision(data.current)}{data.branch ? ` · ${data.branch}` : ''}{data.latest && data.latest !== data.current ? ` → ${revision(data.latest)}` : ''}</small></div><span className="status-pill" role="status">{data.connected ? states[data.state] : data.configured ? '도구 연결 끊김' : '도구 연결 필요'}</span></div>
        <div className="setting"><div><b>{data.checkedAt ? `최근 확인 · ${new Date(data.checkedAt).toLocaleString('ko-KR')}` : '설치 방식과 새 버전을 확인합니다'}</b><small>{data.state === 'restart-required' ? '빌드를 마쳤어요. 호스트에서 MOA 서버를 재시작해 주세요.' : data.ahead ? `현재 브랜치에 원격보다 앞선 커밋이 ${data.ahead}개 있어요.` : '업데이트 중에는 재생과 접속이 잠시 끊길 수 있어요.'}</small></div><Button disabled={!data.connected || busy} onClick={() => action.mutate('check')}>업데이트 확인</Button></div>
        {data.connected && data.state === 'available' && <div className="setting"><div><b>새 버전이 있어요</b><small>현재 설치의 데이터와 설정을 유지하고 업데이트합니다.</small></div><Button variant="primary" disabled={busy} onClick={() => { action.reset(); setConfirm(true); }}>업데이트</Button></div>}
        {(!data.configured || !data.connected || error === 'update-version-unknown') && <p className="settings-hint translation-message">{error === 'update-version-unknown' ? '배포 버전 정보를 설정해 주세요.' : '호스트에 업데이트 도구를 연결해 주세요.'} <a className="text-btn" href="https://github.com/bigbends/moa/blob/fix/subtitles-and-player-ui/docs/UPDATES.md" target="_blank" rel="noreferrer">설정 안내</a></p>}
        {error && <p className="settings-error translation-message" role="alert">{errors[error] || '업데이트하지 못했어요. 호스트 상태를 확인하고 다시 시도해 주세요.'}</p>}
      </>}
    </div>
    {confirm && <ConfirmDialog title="서버를 업데이트할까요?" confirmLabel="업데이트" busy={action.isPending} onClose={() => setConfirm(false)} onConfirm={() => action.mutate('apply')}>새 버전을 설치합니다. {data?.mode === 'git' ? '자동 재시작을 설정하지 않았다면 설치 후 호스트에서 서버를 재시작해 주세요.' : '서버를 재시작하는 동안 영상 재생이 잠시 중단될 수 있어요.'}{error && <p className="settings-error" role="alert">{errors[error] || '업데이트를 시작하지 못했어요.'}</p>}</ConfirmDialog>}
  </section>;
}
