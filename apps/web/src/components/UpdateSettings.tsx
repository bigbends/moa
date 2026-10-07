import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdatePolicy, UpdateStatus } from '@moa/shared';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { Button, ConfirmDialog, Select, Skeleton } from './ui';

const key = ['admin', 'updates'];
const states: Record<UpdateStatus['state'], string> = {
  idle: '확인 전', checking: '업데이트 확인 중…', updating: '업데이트 중…', current: '최신 상태', available: '업데이트 가능', blocked: '호스트 확인 필요', failed: '업데이트 실패', 'restart-required': '서버 재시작 필요',
  downloading: '다운로드 중…', preflight: '설치 전 확인 중…', waiting: '적용 대기 중', backup: '백업 중…', applying: '적용 중…', verifying: '상태 확인 중…', 'rolling-back': '이전 버전 복구 중…', 'rolled-back': '이전 버전으로 복구됨', 'recovery-required': '수동 복구 필요'
};
const busyStates: UpdateStatus['state'][] = ['checking', 'updating', 'downloading', 'preflight', 'backup', 'applying', 'verifying', 'rolling-back'];
const steps: UpdateStatus['state'][] = ['downloading', 'preflight', 'backup', 'applying', 'verifying'];
const deferred: Record<NonNullable<UpdateStatus['deferredReason']>, string> = {
  busy: '재생이나 진행 중인 작업이 끝나면 업데이트해요.',
  offline: '서버 상태를 확인하지 못해 업데이트를 미뤘어요.',
  'outside-window': '설정한 시간이 되면 업데이트해요.'
};
const outcomes: Record<NonNullable<UpdateStatus['history']>[number]['outcome'], string> = { complete: '완료', 'rolled-back': '복구됨', failed: '실패' };
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
  'update-release-incomplete': '새 릴리스 파일이 아직 준비되지 않았어요. 나중에 다시 확인해 주세요.',
  'update-signature-invalid': '릴리스 서명을 확인하지 못해 설치를 중단했어요.',
  'update-migration-required': '이 버전은 수동 이관이 필요해요. 릴리스 안내를 확인해 주세요.',
  'update-tool-required': '먼저 업데이트 도구를 갱신해 주세요.',
  'update-platform-unsupported': '현재 서버 환경을 지원하는 릴리스가 아니에요.',
  'update-compose-required': '먼저 호스트의 Docker Compose를 갱신해 주세요.',
  'update-rate-limited': '업데이트 서버의 요청 제한에 도달했어요. 나중에 다시 확인해 주세요.',
  'update-app-busy': '재생이나 다른 작업이 진행 중이에요. 끝난 뒤 다시 시도해 주세요.',
  'update-space-required': '백업과 업데이트에 필요한 디스크 공간을 확보해 주세요.',
  'update-no-releases': '선택한 채널에 공개된 릴리스가 아직 없어요.',
  'update-rolled-back': '이전 버전으로 복구했어요. 업데이트 기록을 확인해 주세요.',
  'update-recovery-required': '자동 복구를 마치지 못했어요. 설치 안내의 복구 방법을 확인해 주세요.',
  'update-invalid-policy': '업데이트 설정의 시간대와 시간 구간을 확인해 주세요.',
  'update-not-available': '업데이트 상태가 바뀌었어요. 다시 확인해 주세요.'
};
const revision = (value: string) => value === 'unknown' ? '알 수 없음' : value.replace(/^sha256:/, '').slice(0, 12);
const version = (value: string) => value === 'unknown' ? '사용자 빌드' : /^\d/.test(value) ? `v${value}` : value;
const when = (at: number) => new Date(at).toLocaleString('ko-KR');
const notesLink = (url: string | null | undefined) => {
  try { const u = new URL(url || ''); return u.protocol === 'https:' && u.hostname === 'github.com' ? u.href : null; } catch { return null; }
};

type Form = Omit<UpdatePolicy, 'intervalHours'> & { intervalHours: string };
const defaults: UpdatePolicy = { channel: 'stable', autoCheck: true, autoApply: false, intervalHours: 6, timezone: 'UTC', windowStart: '03:00', windowEnd: '05:00' };
const toForm = (policy: UpdatePolicy): Form => ({ ...policy, intervalHours: String(policy.intervalHours) });
const same = (a?: UpdatePolicy | null, b?: UpdatePolicy | null) => !!a && !!b && (Object.keys(defaults) as (keyof UpdatePolicy)[]).every(name => a[name] === b[name]);
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
const validZone = (zone: string) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return !!zone; } catch { return false; } };
function parse(form: Form): UpdatePolicy | string {
  const hours = Number(form.intervalHours);
  if (!/^\d+$/.test(form.intervalHours) || hours < 1 || hours > 168) return '확인 간격은 1–168시간으로 입력해 주세요.';
  if (form.autoApply) {
    if (!validZone(form.timezone)) return '시간대를 다시 선택해 주세요.';
    if (!clock.test(form.windowStart) || !clock.test(form.windowEnd)) return '시간은 00:00 형식으로 입력해 주세요.';
    if (form.windowStart === form.windowEnd) return '시작과 끝 시간을 다르게 정해 주세요.';
  }
  return { ...form, intervalHours: hours };
}

export function UpdateSettings() {
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState<Form | null>(null);
  const [pending, setPending] = useState<UpdatePolicy | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = useQuery({ queryKey: key, queryFn: () => api<UpdateStatus>('/admin/updates'), refetchInterval: 3000 });
  const action = useMutation({
    mutationFn: (name: 'check' | 'apply') => api<UpdateStatus>(`/admin/updates/${name}`, { method: 'POST', body: {} }),
    onSuccess: data => { client.setQueryData(key, data); setConfirm(false); },
    onError: () => { void client.invalidateQueries({ queryKey: key }); }
  });
  // The host applies settings asynchronously; keep the saved values on screen until polling shows them.
  const save = useMutation({
    mutationFn: (policy: UpdatePolicy) => api<UpdateStatus>('/admin/updates/settings', { method: 'PATCH', body: { ...policy } }),
    onMutate: () => setMessage(null),
    onSuccess: (data, policy) => { client.setQueryData(key, data); if (same(data.policy, policy)) setDraft(null); else setPending(policy); },
    onError: error => setMessage(error instanceof ApiError && errors[error.code] || '설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
  });
  const data = status.data;
  const server = data?.policy;
  useEffect(() => { if (pending && same(server, pending)) { setPending(null); setDraft(null); } }, [server, pending]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => { setPending(null); setMessage('업데이트 도구가 아직 설정을 반영하지 않았어요. 연결을 확인하고 다시 저장해 주세요.'); }, 60_000);
    return () => clearTimeout(timer);
  }, [pending]);
  const zones = useMemo(() => {
    const list = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return list.includes('UTC') ? list : ['UTC', ...list];
  }, []);

  const release = data?.mode === 'release';
  const busy = action.isPending || !!data && busyStates.includes(data.state);
  const syncing = save.isPending || !!pending;
  const error = action.error instanceof ApiError ? action.error.code : action.error ? 'update-failed' : data?.error;
  const base = server ?? { ...defaults, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
  const form = draft ?? toForm(pending ?? base);
  const editable = release && !!data?.connected && !busy && !syncing;
  const parsed = parse(form);
  const dirty = !!draft && (typeof parsed === 'string' || !same(parsed, base));
  const edit = (patch: Partial<Form>) => { setMessage(null); setDraft({ ...form, ...patch }); };
  const canApply = !!data?.connected && (data.state === 'available' || data.state === 'waiting') && !busy && !syncing;
  const step = data ? steps.indexOf(data.state) : -1;
  const notes = notesLink(data?.notesUrl);
  const history = data?.history ?? [];

  return <section className="settings-group" id="updates">
    <h2>업데이트</h2>
    <div className="settings-card">
      {!data ? status.isPending ? <Skeleton className="folder-sk" /> : <div className="setting"><p className="settings-error" role="alert">업데이트 정보를 불러오지 못했어요.</p><Button onClick={() => void status.refetch()}>다시 시도</Button></div> : <>
        {release
          ? <div className="setting"><div><b>MOA {version(data.current)}</b><small>{base.channel === 'beta' ? '베타' : '정식'} 채널{data.latest && data.latest !== data.current ? ` · 새 버전 ${version(data.latest)}` : ''}</small></div><span className={cx('status-pill', data.connected && data.state === 'current' && 'is-ok')} role="status">{data.connected ? states[data.state] : data.configured ? '도구 연결 끊김' : '도구 연결 필요'}</span></div>
          : <div className="setting"><div><b>{data.mode === 'docker' ? 'Docker' : data.mode === 'git' ? 'Git' : '서버'} 업데이트</b><small>현재 {revision(data.current)}{data.branch ? ` · ${data.branch}` : ''}{data.latest && data.latest !== data.current ? ` → ${revision(data.latest)}` : ''}</small></div><span className="status-pill" role="status">{data.connected ? states[data.state] : data.configured ? '도구 연결 끊김' : '도구 연결 필요'}</span></div>}
        {release && data.connected && step >= 0 && <div className="setting update-progress"><div><b>{states[data.state]} <span className="update-step">{step + 1}/{steps.length}</span></b><small>잠시 접속이 끊겨도 업데이트는 계속돼요. 다시 연결되면 결과를 보여 드려요.</small></div></div>}
        {release && data.connected && data.state === 'rolling-back' && <div className="setting"><div><b>문제가 생겨 이전 버전으로 되돌리는 중이에요</b><small>잠시 기다려 주세요. 저장된 데이터를 유지하며 이전 버전을 다시 실행해요.</small></div></div>}
        {release && data.state === 'rolled-back' && <p className="settings-hint translation-message" role="status">새 버전에 문제가 있어 이전 버전으로 되돌렸어요. 같은 버전은 자동으로 다시 설치하지 않아요.</p>}
        {release && data.state === 'recovery-required' && <p className="settings-error translation-message" role="alert">자동 복구를 마치지 못했어요. 설치 안내의 복구 방법을 확인해 주세요.</p>}
        <div className="setting"><div><b>{data.checkedAt ? `최근 확인 · ${when(data.checkedAt)}` : '설치 방식과 새 버전을 확인합니다'}</b><small>{release
          ? data.nextCheckAt && base.autoCheck ? `다음 확인 · ${when(data.nextCheckAt)}` : '확인만 하고, 설치는 따로 진행해요.'
          : data.state === 'restart-required' ? '빌드를 마쳤어요. 호스트에서 MOA 서버를 재시작해 주세요.' : data.ahead ? `현재 브랜치에 원격보다 앞선 커밋이 ${data.ahead}개 있어요.` : '업데이트 중에는 재생과 접속이 잠시 끊길 수 있어요.'}</small></div><Button disabled={!data.connected || busy} onClick={() => action.mutate('check')}>업데이트 확인</Button></div>
        {release ? data.connected && (data.state === 'available' || data.state === 'waiting') && <div className="setting"><div>
            <b>{data.state === 'waiting' ? `${version(data.latest || '')} 자동 업데이트 대기 중` : `새 버전 ${version(data.latest || '')}`}</b>
            <small>{data.state === 'waiting' && data.deferredReason ? deferred[data.deferredReason] : '데이터와 설정은 그대로 유지돼요.'}{notes && <> <a className="text-btn update-notes" href={notes} target="_blank" rel="noreferrer">변경 사항 보기</a></>}</small>
          </div><div className="update-actions">
            {data.state === 'waiting' && base.autoApply && <Button disabled={!editable || !server} onClick={() => server && save.mutate({ ...server, autoApply: false })}>예약 취소</Button>}
            <Button variant="primary" disabled={!canApply} onClick={() => { action.reset(); setConfirm(true); }}>지금 업데이트</Button>
          </div></div>
          : data.connected && data.state === 'available' && <div className="setting"><div><b>새 버전이 있어요</b><small>현재 설치의 데이터와 설정을 유지하고 업데이트합니다.</small></div><Button variant="primary" disabled={busy} onClick={() => { action.reset(); setConfirm(true); }}>업데이트</Button></div>}

        {release && <fieldset className="update-policy" disabled={!editable}>
          <legend className="sr-only">업데이트 설정</legend>
          <div className="setting"><div><b>업데이트 채널</b><small>{form.channel === 'beta' && base.channel !== 'beta' ? '베타는 새 기능을 먼저 쓰는 대신 문제가 있을 수 있어요.' : '정식은 충분히 확인한 버전만 받아요.'}</small></div>
            <Select className="setting-select" aria-label="업데이트 채널" value={form.channel} disabled={!editable} options={[{ value: 'stable', label: '정식' }, { value: 'beta', label: '베타' }]} onChange={value => edit({ channel: value as UpdatePolicy['channel'] })} /></div>
          <div className="setting"><div><b>자동 확인</b><small>새 버전이 있는지만 확인해요.</small></div>
            <button type="button" role="switch" aria-checked={form.autoCheck} aria-label="자동 확인" className={cx('switch', form.autoCheck && 'is-on')} onClick={() => edit({ autoCheck: !form.autoCheck })}><i /></button></div>
          {form.autoCheck && <div className="setting"><div><b>확인 간격</b><small>1–168시간</small></div>
            <label className="translation-batch"><input aria-label="확인 간격(시간)" inputMode="numeric" value={form.intervalHours} onChange={event => edit({ intervalHours: event.target.value.replace(/\D/g, '').slice(0, 3) })} /><span>시간</span></label></div>}
          <div className="setting"><div><b>자동 업데이트</b><small>정한 시간에 설치해요. 재생 중이면 끝날 때까지 미뤄요.</small></div>
            <button type="button" role="switch" aria-checked={form.autoApply} aria-label="자동 업데이트" className={cx('switch', form.autoApply && 'is-on')} onClick={() => edit({ autoApply: !form.autoApply })}><i /></button></div>
          {form.autoApply && <>
            <div className="setting"><div><b>시간대</b><small>서버 기준 시간대</small></div>
              {zones.length > 1
                ? <Select className="setting-select" aria-label="시간대" value={form.timezone} disabled={!editable} options={(zones.includes(form.timezone) ? zones : [form.timezone, ...zones]).map(zone => ({ value: zone, label: zone }))} onChange={timezone => edit({ timezone })} />
                : <input className="update-zone" aria-label="시간대" value={form.timezone} placeholder="Asia/Seoul" onChange={event => edit({ timezone: event.target.value.trim() })} />}</div>
            <div className="setting"><div><b>업데이트 시간</b><small>{clock.test(form.windowStart) && clock.test(form.windowEnd) && form.windowEnd < form.windowStart ? '다음 날까지 이어지는 시간이에요.' : '이 시간 안에서만 설치해요.'}</small></div>
              <div className="update-window">
                <input type="time" step={60} aria-label="시작 시간" value={form.windowStart} onChange={event => edit({ windowStart: event.target.value })} />
                <span aria-hidden="true">–</span>
                <input type="time" step={60} aria-label="끝 시간" value={form.windowEnd} onChange={event => edit({ windowEnd: event.target.value })} />
              </div></div>
          </>}
        </fieldset>}
        {release && (dirty || syncing) && <div className="setting update-save"><small className={cx(typeof parsed === 'string' && dirty ? 'settings-error' : 'settings-hint')} role="status">{syncing ? '업데이트 도구에 반영하는 중…' : typeof parsed === 'string' ? parsed : '저장하지 않은 변경이 있어요.'}</small>
            <div className="update-actions">
              <Button type="button" disabled={syncing} onClick={() => { setDraft(null); setMessage(null); }}>되돌리기</Button>
              <Button type="button" variant="primary" disabled={!editable || !dirty || typeof parsed === 'string'} onClick={() => typeof parsed !== 'string' && save.mutate(parsed)}>{syncing ? '저장 중…' : '설정 저장'}</Button>
            </div></div>}
        {release && data.connected && busy && <p className="settings-hint translation-message">업데이트가 끝나면 설정을 바꿀 수 있어요.</p>}
        {message && <p className="settings-error translation-message" role="alert">{message}</p>}

        {release && (data.updaterVersion || history.length > 0) && <details className="update-details">
          <summary>자세히</summary>
          <dl>
            <dt>설치 버전</dt><dd>{data.current === 'unknown' ? '사용자 빌드' : version(data.current)}</dd>
            {data.updaterVersion && <><dt>업데이트 도구</dt><dd>{version(data.updaterVersion)}</dd></>}
          </dl>
          {history.length > 0 && <ol aria-label="업데이트 기록">{history.map(item => <li key={`${item.at}-${item.version}`}>
            <span>{version(item.previous)} → {version(item.version)}</span><small>{when(item.at)}</small><span className={cx('status-pill', item.outcome === 'complete' && 'is-ok')}>{outcomes[item.outcome]}</span>
          </li>)}</ol>}
        </details>}

        {(!data.configured || !data.connected || error === 'update-version-unknown') && <p className="settings-hint translation-message">{error === 'update-version-unknown' ? '배포 버전 정보를 설정해 주세요.' : '호스트에 업데이트 도구를 연결해 주세요.'} <a className="text-btn" href="https://github.com/sidetool/moa/blob/main/docs/UPDATES.md" target="_blank" rel="noreferrer">설정 안내</a></p>}
        {error && <p className="settings-error translation-message" role="alert">{errors[error] || '업데이트하지 못했어요. 호스트 상태를 확인하고 다시 시도해 주세요.'}</p>}
      </>}
    </div>
    {confirm && <ConfirmDialog title="서버를 업데이트할까요?" confirmLabel="업데이트" busy={action.isPending} onClose={() => setConfirm(false)} onConfirm={() => action.mutate('apply')}>{release ? `새 버전(${version(data?.latest || '')})을 설치합니다. ` : '새 버전을 설치합니다. '}{data?.mode === 'git' ? '자동 재시작을 설정하지 않았다면 설치 후 호스트에서 서버를 재시작해 주세요.' : '서버를 재시작하는 동안 영상 재생이 잠시 중단될 수 있어요.'}{error && <p className="settings-error" role="alert">{errors[error] || '업데이트를 시작하지 못했어요.'}</p>}</ConfirmDialog>}
  </section>;
}
