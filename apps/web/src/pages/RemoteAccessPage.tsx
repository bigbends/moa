import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Globe, Lock, ShieldAlert } from 'lucide-react';
import { encode } from 'uqr';
import type { RemoteAccessConfigure, RemoteAccessMode, RemoteAccessStatus } from '@moa/shared';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { Button, Skeleton, Spinner } from '../components/ui';

type Mode = Exclude<RemoteAccessMode, 'off'>;
const statusKey = ['remote-access'] as const;

const MODES: { mode: Mode; title: string; via: string; short: string; body: string }[] = [
  { mode: 'cloudflare-quick', title: '빠른 연결', via: 'Cloudflare · 계정 없이', short: 'Cloudflare 빠른 연결', body: '버튼 하나로 임시 주소를 만들어요. 서버를 다시 켜면 주소가 바뀌어서 써 보기에 좋아요.' },
  { mode: 'cloudflare-token', title: '내 도메인으로 연결', via: 'Cloudflare Tunnel', short: 'Cloudflare Tunnel', body: '내 도메인을 고정 주소로 써요. Cloudflare 계정과 도메인이 필요해요.' },
  { mode: 'tailscale', title: '내 기기에서만', via: 'Tailscale', short: 'Tailscale', body: 'Tailscale에 로그인한 내 기기에서만 열려요. 인터넷에 공개되지 않아 가장 안전해요.' }
];

const ERRORS: Record<string, string> = {
  'connector-unavailable': '연결 도우미(moa-connector)가 실행 중이 아니에요. 서버에서 컨테이너가 켜져 있는지 확인해 주세요.',
  'connector-operation-failed': '연결 설정을 적용하지 못했어요. 입력한 값을 확인하고 다시 시도해 주세요.',
  'connector-process-failed': '연결 프로그램이 멈췄어요. 다시 시도해 보고, 계속되면 토큰이나 계정 설정을 확인해 주세요.',
  'connector-process-exited': '연결 프로그램이 멈췄어요. 다시 시도해 보고, 계속되면 토큰이나 계정 설정을 확인해 주세요.',
  'login-gate-and-admin-required': '로그인을 켜고 관리자 계정이 있어야 원격 접속을 켤 수 있어요.',
  'invalid-public-hostname': '공개 주소는 tv.example.com처럼 도메인만 입력해 주세요.',
  'invalid-secret': '토큰이나 인증 키 형식이 올바르지 않아요.',
  'cloudflare-token-and-hostname-required': '터널 토큰과 공개 주소를 모두 입력해 주세요.',
  'remote-access-externally-managed': '서버 설정 파일로 관리되는 터널이 있어서 여기서 바꿀 수 없어요.'
};
const errorText = (code: string | null | undefined) => code ? ERRORS[code] ?? '연결하지 못했어요. 잠시 후 다시 시도해 주세요.' : '';
const modeName = (mode: RemoteAccessMode) => MODES.find(m => m.mode === mode)?.short ?? '';
const isPublic = (mode: RemoteAccessMode, funnel: boolean) => mode === 'cloudflare-quick' || mode === 'cloudflare-token' || (mode === 'tailscale' && funnel);

function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const { data, size } = encode(text, { ecc: 'M', border: 0 });
    let d = '';
    data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
    return { d, size };
  }, [text]);
  return <svg className="remote-qr" viewBox={`-2 -2 ${path.size + 4} ${path.size + 4}`} role="img" aria-label="접속 주소 QR 코드" shapeRendering="crispEdges">
    <rect x="-2" y="-2" width={path.size + 4} height={path.size + 4} fill="#fff" />
    <path d={path.d} fill="#09090b" />
  </svg>;
}

function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1600); return () => clearTimeout(t); }, [done]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      // Clipboard API needs a secure context; plain-HTTP LAN access falls back to a selection copy.
      const area = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(area); area.select(); document.execCommand('copy'); area.remove();
    }
    setDone(true);
  };
  return <Button type="button" icon={done ? <Check size={16} /> : <Copy size={16} />} onClick={() => void copy()}>{done ? '복사됨' : label}</Button>;
}

function StatusCard({ status, onStop, onRetry, busy }: { status: RemoteAccessStatus; onStop: () => void; onRetry: () => void; busy: boolean }) {
  const pub = isPublic(status.mode, status.funnel);
  const url = status.url;
  return <section className={cx('remote-status', `is-${status.state}`)} aria-live="polite">
    <header className="remote-status-head">
      <span className={cx('remote-dot', `is-${status.state}`)} aria-hidden="true" />
      <div>
        <b>{status.state === 'connected' ? '연결됨' : status.state === 'needs-login' ? '로그인이 필요해요' : status.state === 'error' ? '연결하지 못했어요' : '연결하는 중…'}</b>
        <small>{modeName(status.mode)} · {pub ? <><Globe size={12} /> 인터넷에 공개</> : <><Lock size={12} /> 내 기기에서만</>}</small>
      </div>
      <Button type="button" variant="ghost" disabled={busy} onClick={onStop}>연결 끊기</Button>
    </header>

    {status.state === 'connected' && url && <div className="remote-connected">
      <QrCode text={url} />
      <div className="remote-url">
        <small>접속 주소</small>
        <a href={url} target="_blank" rel="noreferrer" className="remote-url-text">{url.replace(/^https?:\/\//, '')}</a>
        <div className="remote-url-actions"><CopyButton text={url} label="주소 복사" /></div>
        <p>휴대폰 카메라로 QR을 찍으면 바로 열려요.{status.mode === 'cloudflare-quick' && ' 서버를 다시 켜면 주소가 바뀌어요.'}</p>
      </div>
    </div>}
    {status.state === 'connected' && !url && <p className="remote-status-body">연결은 됐지만 주소를 아직 받지 못했어요. 잠시 기다려 주세요.</p>}

    {status.state === 'starting' && <p className="remote-status-body"><Spinner size={16} /> 연결 프로그램을 켜고 있어요. 보통 10초 안에 끝나요.</p>}

    {status.state === 'needs-login' && <div className="remote-status-body">
      <p>Tailscale 계정으로 이 서버를 내 기기 목록에 추가해 주세요. 로그인을 마치면 15초쯤 뒤 자동으로 연결돼요.</p>
      {status.loginUrl && <a className="btn btn-primary btn-m" href={status.loginUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /><span>Tailscale에 로그인</span></a>}
    </div>}

    {status.state === 'error' && <div className="remote-status-body">
      <p className="settings-error" role="alert">{errorText(status.lastError)}</p>
      <Button type="button" disabled={busy} onClick={onRetry}>다시 시도</Button>
    </div>}
  </section>;
}

export function RemoteAccessPage() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => api<RemoteAccessStatus>('/admin/remote-access', { signal }),
    // Fast while something is changing; the server reconciles every 15s anyway.
    refetchInterval: query => { const s = query.state.data; return s?.desiredEnabled && s.state !== 'connected' ? 2500 : 10_000; }
  });
  const s = status.data;
  const [mode, setMode] = useState<Mode | null>(null);
  const [token, setToken] = useState('');
  const [hostname, setHostname] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<boolean | null>(null);
  const [authKey, setAuthKey] = useState('');
  const [error, setError] = useState('');

  const current: Mode = mode ?? (s && s.config.mode !== 'off' ? s.config.mode : 'cloudflare-quick');
  const host = hostname ?? s?.config.publicHostname ?? '';
  const wantFunnel = funnel ?? s?.config.funnel ?? false;
  const running = !!s?.desiredEnabled;
  const sameMode = running && s?.mode === current;

  const act = useMutation({
    mutationFn: async (action: 'connect' | 'stop' | 'retry') => {
      if (action === 'stop') return api<RemoteAccessStatus>('/admin/remote-access/stop', { method: 'POST', body: {} });
      if (action === 'retry') return api<RemoteAccessStatus>('/admin/remote-access/start', { method: 'POST', body: {} });
      const body: RemoteAccessConfigure = { mode: current };
      if (current === 'cloudflare-token') { body.publicHostname = host.trim(); if (token.trim()) body.cloudflareToken = token.trim(); }
      if (current === 'tailscale') { body.funnel = wantFunnel; if (authKey.trim()) body.tailscaleAuthKey = authKey.trim(); }
      const configured = await api<RemoteAccessStatus>('/admin/remote-access/configure', { method: 'POST', body: { ...body } as Record<string, string | boolean | null> });
      return configured.desiredEnabled ? configured : api<RemoteAccessStatus>('/admin/remote-access/start', { method: 'POST', body: {} });
    },
    onMutate: () => setError(''),
    onSuccess: data => { client.setQueryData(statusKey, data); setToken(''); setAuthKey(''); setMode(null); setHostname(null); setFunnel(null); },
    onError: e => setError(errorText(e instanceof ApiError ? e.code : 'unknown'))
  });

  const tokenSaved = s?.config.cloudflareToken === '********';
  const changed = !!token.trim() || !!authKey.trim() || (hostname !== null && hostname !== s?.config.publicHostname) || (funnel !== null && funnel !== s?.config.funnel);
  const ready = (current !== 'cloudflare-token' || ((token.trim() || tokenSaved) && host.trim())) && (!sameMode || changed);
  const pub = isPublic(current, wantFunnel);
  const gateway = (s?.gatewayServiceUrl ?? 'http://moa-gateway:8080').replace(/^https?:\/\//, '');

  return <div className="page-pad narrow settings-page remote-page">
    <header className="page-head"><h1>원격 접속</h1></header>
    <p className="remote-lead">집 밖에서도 휴대폰이나 다른 기기로 MOA를 열 수 있게 연결해요. 연결된 주소로 들어와도 로그인은 그대로 거쳐요.</p>

    {status.isPending ? <Skeleton className="remote-sk" />
      : status.isError || !s ? <p className="settings-error" role="alert">원격 접속 상태를 불러오지 못했어요. <button className="text-btn" onClick={() => void status.refetch()}>다시 시도</button></p>
      : s.externallyManaged ? <div className="remote-note"><b>서버 설정으로 관리되는 터널이 있어요</b><p>이 서버는 설정 파일(compose.tunnel.yaml)로 터널을 운영하고 있어서 여기서는 바꿀 수 없어요.</p></div>
      : !s.available ? <div className="remote-note"><b>연결 도우미가 없어요</b><p>원격 접속에는 <code>moa-connector</code> 컨테이너가 필요해요. 기본 compose 파일로 설치했는지 확인해 주세요.</p></div>
      : <>
        {running && <StatusCard status={s} busy={act.isPending} onStop={() => act.mutate('stop')} onRetry={() => act.mutate('retry')} />}

        <section className="settings-group">
          <h2>{running ? '연결 방식' : '어떻게 연결할까요?'}</h2>
          <div className="remote-modes" role="radiogroup" aria-label="연결 방식">
            {MODES.map(m => {
              const selected = m.mode === current;
              const open = isPublic(m.mode, m.mode === 'tailscale' && selected && wantFunnel);
              return <button key={m.mode} type="button" role="radio" aria-checked={selected} className={cx('remote-mode', selected && 'is-selected')} onClick={() => { setMode(m.mode); setError(''); }}>
                <span className="remote-mode-head"><b>{m.title}</b>{running && s.mode === m.mode && <em>사용 중</em>}</span>
                <small className="remote-mode-via">{m.via}</small>
                <span className="remote-mode-body">{m.body}</span>
                <span className={cx('remote-mode-scope', open ? 'is-public' : 'is-private')}>{open ? <><Globe size={13} /> 인터넷에 공개</> : <><Lock size={13} /> 내 기기에서만</>}</span>
              </button>;
            })}
          </div>

          <form className="remote-form" onSubmit={e => { e.preventDefault(); if (ready) act.mutate('connect'); }}>
            {current === 'cloudflare-token' && <>
              <ol className="remote-steps">
                <li>Cloudflare 대시보드의 <b>Zero Trust → 네트워크 → Tunnels</b>에서 터널을 만들어요.</li>
                <li>설치 명령에 들어 있는 긴 토큰을 복사해 아래에 붙여 넣어요.</li>
                <li><b>Public hostname</b>에 쓸 주소를 정하고, Service를 <b>HTTP</b> · <code>{gateway}</code>로 지정해요. <CopyButton text={gateway} /></li>
              </ol>
              <label className="remote-field"><span>터널 토큰</span>
                <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} placeholder={tokenSaved ? '저장됨 · 바꿀 때만 입력' : 'eyJ로 시작하는 긴 문자열'} />
              </label>
              <label className="remote-field"><span>공개 주소</span>
                <input inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={host} onChange={e => setHostname(e.target.value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))} placeholder="tv.example.com" />
              </label>
            </>}

            {current === 'tailscale' && <>
              <div className="remote-switch">
                <div><b>인터넷에 공개 (Funnel)</b><small>Tailscale이 없는 사람도 주소로 들어올 수 있게 해요. Tailscale 관리 화면에서 Funnel을 허용해야 해요.</small></div>
                <button type="button" role="switch" aria-checked={wantFunnel} aria-label="인터넷에 공개" className={cx('switch', wantFunnel && 'is-on')} onClick={() => setFunnel(!wantFunnel)}><i /></button>
              </div>
              <details className="remote-advanced">
                <summary>인증 키로 연결 (선택)</summary>
                <p>로그인 링크 대신 Tailscale 관리 화면에서 만든 인증 키로 연결해요. 보통은 비워 두면 돼요.</p>
                <input type="password" autoComplete="off" spellCheck={false} value={authKey} onChange={e => setAuthKey(e.target.value)} placeholder={s.config.tailscaleAuthKey ? '저장됨 · 바꿀 때만 입력' : 'tskey-auth-…'} aria-label="Tailscale 인증 키" />
              </details>
            </>}

            {pub && !sameMode && <div className="remote-warning" role="note"><ShieldAlert size={18} /><p>주소를 아는 사람은 누구나 MOA 로그인 화면까지 들어올 수 있어요. 모든 계정의 비밀번호를 길고 서로 다르게 정해 두세요.</p></div>}
            {error && <p className="settings-error" role="alert">{error}</p>}
            {!(sameMode && current === 'cloudflare-quick') && <div className="remote-actions">
              <Button type="submit" variant="primary" disabled={!ready || act.isPending}>
                {act.isPending ? '적용하는 중…' : sameMode ? '설정 저장' : running ? '이 방식으로 바꾸기' : '연결하기'}
              </Button>
            </div>}
          </form>
        </section>
      </>}
  </div>;
}
