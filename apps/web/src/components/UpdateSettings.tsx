import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import type { UpdatePolicy, UpdateStatus } from '@moa/shared';
import { useMe } from '../api/queries';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { busyStates, errorCode, installNote, revision, updateErrors, updatesKey, useUpdateAction, useUpdateNoticePref, useUpdateStatus, version } from '../lib/updates';
import { Button, ConfirmDialog, Select, Skeleton } from './ui';

type Channel = UpdatePolicy['channel'];
const states: Partial<Record<UpdateStatus['state'], string>> = {
  idle: '확인 전', checking: '업데이트 확인 중…', updating: '업데이트 중…', current: '최신 상태', available: '업데이트 가능', blocked: '호스트 확인 필요', failed: '업데이트 실패', 'restart-required': '서버 재시작 필요',
  downloading: '다운로드 중…', preflight: '설치 전 확인 중…', backup: '백업 중…', applying: '적용 중…', verifying: '상태 확인 중…', 'rolling-back': '이전 버전 복구 중…', 'rolled-back': '이전 버전으로 복구됨', 'recovery-required': '수동 복구 필요'
};
const steps: UpdateStatus['state'][] = ['downloading', 'preflight', 'backup', 'applying', 'verifying'];
const outcomes: Record<NonNullable<UpdateStatus['history']>[number]['outcome'], string> = { complete: '완료', 'rolled-back': '복구됨', failed: '실패' };
const when = (at: number) => new Date(at).toLocaleString('ko-KR');
const notesLink = (url: string | null | undefined) => {
  try { const u = new URL(url || ''); return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : null; } catch { return null; }
};

export function UpdateSettings() {
  const client = useQueryClient();
  const me = useMe().data;
  const notice = useUpdateNoticePref(me?.id);
  const section = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState<Channel | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = useUpdateStatus({ refetchInterval: 3000 });
  const action = useUpdateAction(() => setConfirm(false));
  // The host applies the channel asynchronously; show the chosen value until polling confirms it.
  const save = useMutation({
    mutationFn: (channel: Channel) => api<UpdateStatus>('/admin/updates/settings', { method: 'PATCH', body: { channel } }),
    onMutate: channel => { setMessage(null); setPending(channel); },
    onSuccess: data => client.setQueryData(updatesKey, data),
    onError: error => { setPending(null); setMessage(error instanceof ApiError && updateErrors[error.code] || '설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  });
  const data = status.data;
  const server = data?.policy?.channel;
  useEffect(() => { if (pending && server === pending && !save.isPending) setPending(null); }, [server, pending, save.isPending]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(null); setMessage('업데이트 도구가 아직 채널을 반영하지 않았어요. 연결을 확인하고 다시 선택해 주세요.'); }, 60_000);
    return () => clearTimeout(timer);
  }, [pending]);
  const loaded = !!data;
  useEffect(() => { if (loaded && hash === '#updates') section.current?.scrollIntoView({ block: 'start' }); }, [loaded, hash]);

  const release = data?.mode === 'release';
  const busy = action.isPending || !!data && busyStates.includes(data.state);
  const error = errorCode(action.error) ?? data?.error;
  const channel = pending ?? server ?? 'stable';
  const canApply = !!data?.connected && data.state === 'available' && !busy && !pending;
  const step = data ? steps.indexOf(data.state) : -1;
  const notes = notesLink(data?.notesUrl);
  const history = data?.history ?? [];
  const pill = (ok: boolean) => data && <span className={cx('status-pill', ok && 'is-ok')} role="status">{data.connected ? states[data.state] ?? data.state : data.configured ? '도구 연결 끊김' : '도구 연결 필요'}</span>;

  return <section className="settings-group" id="updates" ref={section}>
    <h2>업데이트</h2>
    <div className="settings-card">
      {!data ? status.isPending ? <Skeleton className="folder-sk" /> : <div className="setting"><p className="settings-error" role="alert">업데이트 정보를 불러오지 못했어요.</p><Button onClick={() => void status.refetch()}>다시 시도</Button></div> : <>
        {release
          ? <div className="setting"><div><b>MOA {version(data.current)}</b><small>{server === 'beta' ? '베타' : '정식'} 채널{data.latest && data.latest !== data.current ? ` · 새 버전 ${version(data.latest)}` : ''}</small></div>{pill(data.connected && data.state === 'current')}</div>
          : <div className="setting"><div><b>{data.mode === 'docker' ? 'Docker' : data.mode === 'git' ? 'Git' : '서버'} 업데이트</b><small>현재 {revision(data.current)}{data.branch ? ` · ${data.branch}` : ''}{data.latest && data.latest !== data.current ? ` → ${revision(data.latest)}` : ''}</small></div>{pill(false)}</div>}
        {release && data.connected && step >= 0 && <div className="setting update-progress"><div><b>{states[data.state]} <span className="update-step">{step + 1}/{steps.length}</span></b><small>잠시 접속이 끊겨도 업데이트는 계속돼요. 다시 연결되면 결과를 보여 드려요.</small></div></div>}
        {release && data.connected && data.state === 'rolling-back' && <div className="setting"><div><b>문제가 생겨 이전 버전으로 되돌리는 중이에요</b><small>저장된 데이터는 그대로 두고 이전 버전을 다시 실행해요.</small></div></div>}
        {release && data.state === 'rolled-back' && <p className="settings-hint translation-message" role="status">새 버전에 문제가 있어 이전 버전으로 되돌렸어요.</p>}
        {release && data.state === 'recovery-required' && error !== 'update-recovery-required' && <p className="settings-error translation-message" role="alert">{updateErrors['update-recovery-required']}</p>}
        <div className="setting"><div><b>{data.checkedAt ? `최근 확인 · ${when(data.checkedAt)}` : '새 버전을 확인합니다'}</b><small>{release
          ? '6시간마다 확인해요. 설치는 직접 할 때만 해요.'
          : data.state === 'restart-required' ? '빌드를 마쳤어요. 호스트에서 MOA 서버를 재시작해 주세요.' : data.ahead ? `현재 브랜치에 원격보다 앞선 커밋이 ${data.ahead}개 있어요.` : '업데이트 중에는 재생과 접속이 잠시 끊길 수 있어요.'}</small></div><Button disabled={!data.connected || busy} onClick={() => action.mutate('check')}>업데이트 확인</Button></div>
        {data.connected && data.state === 'available' && <div className="setting"><div>
            <b>{release ? `새 버전 ${version(data.latest || '')}` : '새 버전이 있어요'}</b>
            <small>데이터와 설정은 그대로 유지돼요.{notes && <> <a className="text-btn update-notes" href={notes} target="_blank" rel="noreferrer">변경 사항 보기</a></>}</small>
          </div><Button variant="primary" disabled={!canApply} onClick={() => { action.reset(); setConfirm(true); }}>지금 업데이트</Button></div>}

        {release && <div className="setting"><div><b>업데이트 채널</b><small>{pending ? '업데이트 도구에 반영하는 중…' : channel === 'beta' ? '새 기능을 먼저 받지만 문제가 있을 수 있어요.' : '충분히 확인한 버전만 받아요.'}</small></div>
          <Select className="setting-select" aria-label="업데이트 채널" value={channel} disabled={!data.connected || busy || !!pending} options={[{ value: 'stable', label: '정식' }, { value: 'beta', label: '베타' }]} onChange={value => value !== channel && save.mutate(value as Channel)} /></div>}
        <div className="setting"><div><b>업데이트 알림</b><small>새 버전이 나오면 알려 드려요. 이 브라우저에만 적용돼요.</small></div>
          <button type="button" role="switch" aria-checked={notice.enabled} aria-label="업데이트 알림" className={cx('switch', notice.enabled && 'is-on')} disabled={!me} onClick={() => notice.setEnabled(!notice.enabled)}><i /></button></div>
        {message && <p className="settings-error translation-message" role="alert">{message}</p>}

        {release && (data.updaterVersion || history.length > 0) && <details className="update-details">
          <summary>자세히</summary>
          <dl>
            <dt>설치 버전</dt><dd>{version(data.current)}</dd>
            {data.updaterVersion && <><dt>업데이트 도구</dt><dd>{version(data.updaterVersion)}</dd></>}
          </dl>
          {history.length > 0 && <ol aria-label="업데이트 기록">{history.map(item => <li key={`${item.at}-${item.version}`}>
            <span>{version(item.previous)} → {version(item.version)}</span><small>{when(item.at)}</small><span className={cx('status-pill', item.outcome === 'complete' && 'is-ok')}>{outcomes[item.outcome]}</span>
          </li>)}</ol>}
        </details>}

        {(!data.configured || !data.connected || error === 'update-version-unknown') && <p className="settings-hint translation-message">{error === 'update-version-unknown' ? '배포 버전 정보를 설정해 주세요.' : '호스트에 업데이트 도구를 연결해 주세요.'} <a className="text-btn" href="https://github.com/sidetool/moa/blob/main/docs/UPDATES.md" target="_blank" rel="noreferrer">설정 안내</a></p>}
        {error && <p className="settings-error translation-message" role="alert">{updateErrors[error] || '업데이트하지 못했어요. 호스트 상태를 확인하고 다시 시도해 주세요.'}</p>}
      </>}
    </div>
    {confirm && <ConfirmDialog title="서버를 업데이트할까요?" confirmLabel="업데이트" busy={action.isPending} onClose={() => setConfirm(false)} onConfirm={() => action.mutate('apply')}>{release ? `새 버전(${version(data?.latest || '')})을 설치합니다. ` : '새 버전을 설치합니다. '}{installNote(data)}{error && <p className="settings-error" role="alert">{updateErrors[error] || '업데이트를 시작하지 못했어요.'}</p>}</ConfirmDialog>}
  </section>;
}
