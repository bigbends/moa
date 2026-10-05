import { Puzzle, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebsitePlugin, WebsitePluginPackage } from '@moa/shared';
import { api, currentProfileId } from '../lib/api';
import { Button, IconButton } from './ui';

const usePlugins = () => useQuery({ queryKey: ['website-plugins'], queryFn: () => api<WebsitePlugin[]>('/plugins'), retry: false, refetchInterval: 30000 });
const path = (id: string) => `/plugins/${encodeURIComponent(id)}`;
const permissionLabels = { 'player.context': '현재 작품·회차·재생 위치 읽기', 'player.control': '재생·일시정지·탐색', 'subtitles.import': '자막 가져오기·서버 저장', storage: '프로필별 데이터 저장', notifications: '알림 표시' };
type Player = { episodeId: string; title: string; getTime: () => number; onImport: (files: File[]) => Promise<boolean>; control: (action: string, seconds?: number) => Promise<void> };
const act = (pluginId: string, actionId: string) => window.dispatchEvent(new CustomEvent('moa:plugin-action', { detail: { pluginId, actionId } }));
const sdk = `
(() => {
  let port, sequence = 0;
  const pending = new Map(), listeners = new Map();
  const ready = new Promise(resolve => addEventListener('message', event => {
    if (port || event.source !== parent || event.data !== 'moa-connect' || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (data.event) {
        for (const listener of listeners.get(data.event) || []) Promise.resolve().then(() => listener(data.value)).catch(error => call('error', String(error.message || error).slice(0, 200)).catch(() => {}));
        return;
      }
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id); clearTimeout(task.timer);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
    };
    resolve();
  }));
  const call = async (method, value) => {
    await ready;
    if (pending.size >= 4) throw new Error('Too many requests');
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out')); }, 30000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ id, method, value });
    });
  };
  window.moa = Object.freeze({
    on: (event, listener) => {
      if (!['ready', 'timeupdate', 'action'].includes(event) || typeof listener !== 'function') throw new Error('Unknown event or invalid listener');
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
    context: () => call('player.context'),
    player: Object.freeze({ play: () => call('player.control', { action: 'play' }), pause: () => call('player.control', { action: 'pause' }), seek: seconds => call('player.control', { action: 'seek', seconds }) }),
    storage: Object.freeze({ get: () => call('storage'), set: value => call('storage', value) }),
    notify: text => call('notifications', text),
    fetch: async url => {
      const result = await call('fetch', { url });
      return new Response(Uint8Array.from(atob(result.base64), c => c.charCodeAt(0)));
    },
    importSubtitles: async file => {
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024) throw new Error('Choose a subtitle file up to 10 MB');
      return call('subtitles.import', { filename: file.name, bytes: await file.arrayBuffer() });
    }
  });
})();`;

function PluginWindow({ plugin, player, onClose }: { plugin: WebsitePlugin; player?: Player; onClose?: () => void }) {
  const content = useQuery({ queryKey: ['website-plugin', plugin.id, plugin.revision], queryFn: () => api<WebsitePluginPackage & { revision: string }>(path(plugin.id)), staleTime: 0, retry: false });
  const installedPlugins = usePlugins();
  const available = installedPlugins.data?.some(item => item.id === plugin.id && item.enabled && item.revision === plugin.revision) ?? false;
  const granted = useRef(available); granted.current = available;
  const dialog = useRef<HTMLDialogElement>(null), port = useRef<MessagePort | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [dismissed, setDismissed] = useState(false);
  const active = useRef(true);
  const session = useRef(currentProfileId());
  const current = useRef(player); current.current = player;
  const canSend = () => active.current && granted.current && currentProfileId() === session.current;
  const context = () => { const p = current.current; return p ? { episodeId: p.episodeId, title: p.title, currentTime: p.getTime() } : null; };
  useEffect(() => {
    active.current = true; dialog.current?.showModal();
    const action = (event: Event) => { const { pluginId, actionId } = (event as CustomEvent).detail; if (canSend() && pluginId === plugin.id && plugin.actions?.some(a => a.id === actionId)) port.current?.postMessage({ event: 'action', value: { id: actionId } }); };
    window.addEventListener('moa:plugin-action', action);
    const timer = plugin.permissions.includes('player.context') && player ? window.setInterval(() => { if (canSend()) port.current?.postMessage({ event: 'timeupdate', value: context() }); }, 1000) : undefined;
    return () => { active.current = false; port.current?.close(); window.removeEventListener('moa:plugin-action', action); clearInterval(timer); };
  }, []);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => { if (!available) port.current?.close(); }, [available]);
  const connect = (frame: HTMLIFrameElement) => {
    if (!canSend()) return;
    if (port.current) { port.current.close(); setError('플러그인 화면이 이동했어요. 닫은 뒤 다시 열어 주세요.'); return; }
    const channel = new MessageChannel(); port.current = channel.port1;
    let pending = 0;
    channel.port1.onmessage = async ({ data }) => {
      if (!data || !Number.isSafeInteger(data.id) || typeof data.method !== 'string') return;
      const reply = (response: object) => channel.port1.postMessage({ id: data.id, ...response });
      if (pending >= 4) { reply({ error: '요청이 너무 많아요.' }); return; }
      pending++;
      try {
        const installed = (await api<WebsitePlugin[]>('/plugins')).find(p => p.id === plugin.id && p.enabled);
        if (!active.current || currentProfileId() !== session.current) throw new Error('프로필이 변경되었어요. 다시 열어 주세요.');
        if (!installed) throw new Error('사용할 수 없는 플러그인이에요.');
        if (installed.revision !== plugin.revision) throw new Error('플러그인이 업데이트되었어요. 닫은 뒤 다시 열어 주세요.');
        let result: unknown;
        if (data.method === 'fetch') {
          if (typeof data.value?.url !== 'string' || data.value.url.length > 2048) throw new Error('주소를 확인해 주세요.');
          result = await api(`${path(plugin.id)}/request`, { method: 'POST', body: { url: data.value.url, revision: plugin.revision } });
        } else if (data.method === 'player.context' && installed.permissions.includes('player.context')) {
          result = context();
        } else if (data.method === 'player.control' && installed.permissions.includes('player.control')) {
          const value = data.value;
          if (!current.current || !['play', 'pause', 'seek'].includes(value?.action) || value.action === 'seek' && (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds))) throw new Error('재생 요청을 확인해 주세요.');
          await current.current.control(value.action, value.seconds);
        } else if (data.method === 'storage' && installed.permissions.includes('storage')) {
          if (data.value !== undefined && (!data.value || typeof data.value !== 'object' || Array.isArray(data.value))) throw new Error('저장할 데이터를 확인해 주세요.');
          result = await api(`${path(plugin.id)}/storage`, { method: 'POST', body: { revision: plugin.revision, ...(data.value === undefined ? {} : { value: data.value }) } });
        } else if (data.method === 'notifications' && installed.permissions.includes('notifications') || data.method === 'error') {
          if (typeof data.value !== 'string' || !data.value.trim() || data.value.length > 200) throw new Error('알림은 200자 이내로 입력해 주세요.');
          setNotice(data.value); setDismissed(false);
        } else if (data.method === 'subtitles.import' && installed.permissions.includes('subtitles.import')) {
          const value = data.value;
          if (!current.current) throw new Error('재생 화면에서 자막을 가져와 주세요.');
          if (typeof value?.filename !== 'string' || value.filename.length > 255 || !(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength > 10 * 1024 * 1024) throw new Error('자막 파일을 확인해 주세요.');
          result = await current.current.onImport([new File([value.bytes], value.filename)]);
          if (!result) throw new Error('자막을 저장하지 못했어요. 파일을 확인해 주세요.');
        } else throw new Error('허용되지 않은 플러그인 기능이에요.');
        if (!active.current || currentProfileId() !== session.current) throw new Error('프로필이 변경되었어요. 다시 열어 주세요.');
        reply({ result });
      } catch (e) { reply({ error: e instanceof Error ? e.message : '요청에 실패했어요.' }); }
      finally { pending--; }
    };
    frame.contentWindow?.postMessage('moa-connect', '*', [channel.port2]);
    channel.port1.postMessage({ event: 'ready', value: plugin.permissions.includes('player.context') ? context() : null });
  };
  const frame = content.data?.revision === plugin.revision && available && !error && <iframe title={plugin.name} hidden={plugin.kind === 'script'} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={event => connect(event.currentTarget)} srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'"><style>html{color-scheme:dark;font:15px/1.5 system-ui;background:#18181b;color:#fafafa}body{margin:16px}button,input,textarea{font:inherit;max-width:100%;box-sizing:border-box}button{cursor:pointer}</style><script>${sdk}</script>${content.data.script === undefined ? content.data.html : `<script>const script = document.createElement('script'); script.textContent = ${JSON.stringify(content.data.script).replace(/</g, '\\u003c')}; document.head.append(script);</script>`}`} />;
  const failure = error || (content.isError || !installedPlugins.isPending && !available || content.data && content.data.revision !== plugin.revision ? '플러그인을 불러오지 못했어요. 다시 열어 주세요.' : '');
  useEffect(() => { setDismissed(false); }, [failure]);
  if (plugin.kind === 'script') return <>{frame}{!dismissed && (notice || failure) && <div className="plugin-notice" role="status"><b>{plugin.name}</b><span>{failure || notice}</span><IconButton label="알림 닫기" onClick={() => { setNotice(''); setDismissed(true); }}><X size={16} /></IconButton></div>}</>;
  return <dialog ref={dialog} className="plugin-dialog" onCancel={onClose}>
    <header><h2>{plugin.name}</h2><IconButton label="플러그인 닫기" onClick={onClose}><X size={20} /></IconButton></header>
    {content.isPending && <p>플러그인을 여는 중…</p>}
    {failure && <p role="alert" className="form-error">{failure}</p>}{notice && <p role="status">{notice}</p>}{frame}
  </dialog>;
}

export function PluginScripts({ player }: { player?: Player }) {
  const plugins = usePlugins();
  return <>{plugins.data?.filter(plugin => plugin.enabled && plugin.kind === 'script' && plugin.placements.includes(player ? 'player' : 'settings')).map(plugin => <PluginWindow key={`${plugin.id}:${plugin.revision}:${currentProfileId()}:${player?.episodeId || ''}`} plugin={plugin} player={player} />)}</>;
}

export function PluginTools(player: Player) {
  const plugins = usePlugins(), [opened, setOpened] = useState<WebsitePlugin | null>(null);
  return <>{plugins.data?.filter(plugin => plugin.enabled && plugin.placements.includes('player')).flatMap(plugin => plugin.kind === 'script' ? (plugin.actions || []).map(action => <button key={`${plugin.id}:${action.id}`} className="opt opt-action" onClick={() => act(plugin.id, action.id)}><Puzzle size={18} /><span>{action.label}</span><small>{plugin.name}</small></button>) : [<button key={plugin.id} className="opt opt-action" onClick={() => setOpened(plugin)}><Puzzle size={18} /><span>{plugin.name}</span><small>플러그인</small></button>])}{opened && <PluginWindow key={opened.id} plugin={opened} player={player} onClose={() => setOpened(null)} />}</>;
}

export function WebsitePlugins({ admin }: { admin: boolean }) {
  const plugins = usePlugins(), client = useQueryClient(), input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<WebsitePluginPackage | null>(null), [opened, setOpened] = useState<WebsitePlugin | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await client.invalidateQueries({ queryKey: ['website-plugins'] }); }
    catch { setError('플러그인을 처리하지 못했어요. 파일 형식과 연결을 확인해 주세요.'); }
    finally { setBusy(false); }
  };
  const choose = async (file?: File) => {
    if (!file) return;
    setDraft(null); setError('');
    try {
      if (file.size > 256 * 1024) throw new Error();
      const p = JSON.parse(await file.text()) as WebsitePluginPackage;
      if (p.apiVersion !== 1 || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.description !== 'string' || typeof p.version !== 'string' || (typeof p.html === 'string') === (typeof p.script === 'string') || !Array.isArray(p.placements) || !p.placements.every(v => ['settings', 'player'].includes(v)) || !Array.isArray(p.permissions) || !p.permissions.every(v => Object.hasOwn(permissionLabels, v)) || !Array.isArray(p.connect) || !p.connect.every(v => typeof v === 'string')) throw new Error();
      setDraft(p);
    } catch { setError('올바른 MOA 플러그인 JSON 파일을 선택해 주세요. 최대 크기는 256KB예요.'); }
  };
  const shown = plugins.data?.filter(plugin => admin || plugin.placements.includes('settings')) ?? [];
  return <section className="settings-group" id="plugins"><h2>웹사이트 플러그인</h2><div className="settings-card">
    {admin && <div className="setting"><div><b>플러그인 설치</b><small>MOA에 화면과 자동 실행 기능을 추가합니다. 파일과 요청 권한을 확인한 뒤 설치해 주세요.</small></div><Button icon={<Upload size={16} />} disabled={busy} onClick={() => input.current?.click()}>파일 선택</Button><input ref={input} type="file" accept=".json" hidden aria-label="플러그인 파일" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></div>}
    {draft && <div className="plugin-preview"><b>{draft.name} · {draft.version}</b><p>{draft.description}</p>{draft.script !== undefined && <p>이 JavaScript 플러그인은 지정된 페이지에서 자동 실행됩니다.</p>}<p>권한: {draft.permissions.map(p => permissionLabels[p]).join(', ') || '없음'}</p><p>외부 연결: {draft.connect.join(', ') || '없음'}</p><div className="plugin-actions"><Button disabled={busy} variant="primary" onClick={() => void run(async () => { await api('/admin/plugins', { method: 'POST', body: { ...draft } }); setDraft(null); })}>설치·업데이트</Button><Button disabled={busy} onClick={() => setDraft(null)}>취소</Button></div></div>}
    {shown.map(plugin => <div className="setting plugin-row" key={plugin.id}><div><b>{plugin.name} <small>{plugin.version}</small></b><small>{plugin.description}</small></div><div className="plugin-actions">
      {plugin.enabled && plugin.placements.includes('settings') && (plugin.kind === 'script' ? plugin.actions?.map(action => <Button key={action.id} onClick={() => act(plugin.id, action.id)}>{action.label}</Button>) : <Button onClick={() => setOpened(plugin)}>열기</Button>)}
      {admin && <><button role="switch" aria-label={`${plugin.name} 사용`} aria-checked={plugin.enabled} className={`switch ${plugin.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => void run(() => api(`/admin${path(plugin.id)}`, { method: 'PATCH', body: { enabled: !plugin.enabled } }))}><i /></button><Button disabled={busy} onClick={() => { if (confirm(`${plugin.name} 플러그인을 삭제할까요?`)) void run(() => api(`/admin${path(plugin.id)}`, { method: 'DELETE' })); }}>삭제</Button></>}
    </div></div>)}
    {!shown.length && <p className="plugin-empty">설치된 플러그인이 없습니다.</p>}
    {(error || plugins.isError) && <p className="plugin-empty form-error" role="alert">{error || '플러그인 목록을 불러오지 못했어요.'}</p>}
  </div>{opened && <PluginWindow key={opened.id} plugin={opened} onClose={() => setOpened(null)} />}</section>;
}
