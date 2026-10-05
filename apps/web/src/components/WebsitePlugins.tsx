import { Puzzle, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WebsitePlugin, WebsitePluginPackage } from '@moa/shared';
import { api, currentProfileId } from '../lib/api';
import { Button, IconButton } from './ui';

const usePlugins = () => useQuery({ queryKey: ['website-plugins'], queryFn: () => api<WebsitePlugin[]>('/plugins'), retry: false });
const path = (id: string) => `/plugins/${encodeURIComponent(id)}`;
const permissionLabels = { 'player.context': '현재 작품·회차·재생 위치 읽기', 'subtitles.import': '자막 가져오기·서버 저장' };
type Player = { episodeId: string; title: string; getTime: () => number; onImport: (files: File[]) => Promise<boolean> };
const sdk = `
(() => {
  let port, sequence = 0;
  const pending = new Map();
  const ready = new Promise(resolve => addEventListener('message', event => {
    if (port || event.source !== parent || event.data !== 'moa-connect' || !event.ports[0]) return;
    port = event.ports[0];
    port.onmessage = ({ data }) => {
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
    context: () => call('player.context'),
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

function PluginWindow({ plugin, player, onClose }: { plugin: WebsitePlugin; player?: Player; onClose: () => void }) {
  const content = useQuery({ queryKey: ['website-plugin', plugin.id, plugin.revision], queryFn: () => api<WebsitePluginPackage & { revision: string }>(path(plugin.id)), staleTime: 0, retry: false });
  const dialog = useRef<HTMLDialogElement>(null), port = useRef<MessagePort | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  const session = useRef(currentProfileId());
  const current = useRef(player); current.current = player;
  useEffect(() => { active.current = true; dialog.current?.showModal(); return () => { active.current = false; port.current?.close(); }; }, []);
  const connect = (frame: HTMLIFrameElement) => {
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
          const p = current.current; result = p ? { episodeId: p.episodeId, title: p.title, currentTime: p.getTime() } : null;
        } else if (data.method === 'subtitles.import' && installed.permissions.includes('subtitles.import')) {
          const value = data.value;
          if (!current.current) throw new Error('재생 화면에서 자막을 가져와 주세요.');
          if (typeof value?.filename !== 'string' || value.filename.length > 255 || !(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength > 10 * 1024 * 1024) throw new Error('자막 파일을 확인해 주세요.');
          result = await current.current.onImport([new File([value.bytes], value.filename)]);
          if (!result) throw new Error('자막을 저장하지 못했어요. 파일을 확인해 주세요.');
        } else throw new Error('허용되지 않은 플러그인 기능이에요.');
        reply({ result });
      } catch (e) { reply({ error: e instanceof Error ? e.message : '요청에 실패했어요.' }); }
      finally { pending--; }
    };
    frame.contentWindow?.postMessage('moa-connect', '*', [channel.port2]);
  };
  return <dialog ref={dialog} className="plugin-dialog" onCancel={onClose}>
    <header><h2>{plugin.name}</h2><IconButton label="플러그인 닫기" onClick={onClose}><X size={20} /></IconButton></header>
    {content.isPending && <p>플러그인을 여는 중…</p>}
    {(content.isError || error || content.data && content.data.revision !== plugin.revision) && <p role="alert" className="form-error">{error || '플러그인을 불러오지 못했어요. 닫은 뒤 다시 열어 주세요.'}</p>}
    {content.data?.revision === plugin.revision && !error && <iframe title={plugin.name} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={event => connect(event.currentTarget)} srcDoc={`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'"><style>html{color-scheme:dark;font:15px/1.5 system-ui;background:#18181b;color:#fafafa}body{margin:16px}button,input,textarea{font:inherit;max-width:100%;box-sizing:border-box}button{cursor:pointer}</style><script>${sdk}</script>${content.data.html}`} />}
  </dialog>;
}

export function PluginTools(player: Player) {
  const plugins = usePlugins(), [opened, setOpened] = useState<WebsitePlugin | null>(null);
  return <>{plugins.data?.filter(plugin => plugin.enabled && plugin.placements.includes('player')).map(plugin => <button key={plugin.id} className="opt opt-action" onClick={() => setOpened(plugin)}><Puzzle size={18} /><span>{plugin.name}</span><small>플러그인</small></button>)}{opened && <PluginWindow key={opened.id} plugin={opened} player={player} onClose={() => setOpened(null)} />}</>;
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
      if (p.apiVersion !== 1 || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.description !== 'string' || typeof p.version !== 'string' || typeof p.html !== 'string' || !Array.isArray(p.placements) || !p.placements.every(v => ['settings', 'player'].includes(v)) || !Array.isArray(p.permissions) || !p.permissions.every(v => Object.hasOwn(permissionLabels, v)) || !Array.isArray(p.connect) || !p.connect.every(v => typeof v === 'string')) throw new Error();
      setDraft(p);
    } catch { setError('올바른 MOA 플러그인 JSON 파일을 선택해 주세요. 최대 크기는 256KB예요.'); }
  };
  const shown = plugins.data?.filter(plugin => admin || plugin.placements.includes('settings')) ?? [];
  if (!admin && !shown.length) return null;
  return <section className="settings-group" id="plugins"><h2>웹사이트 플러그인</h2><div className="settings-card">
    {admin && <div className="setting"><div><b>플러그인 설치</b><small>MOA 화면에 도구를 추가합니다. 파일과 요청 권한을 확인한 뒤 설치해 주세요.</small></div><Button icon={<Upload size={16} />} disabled={busy} onClick={() => input.current?.click()}>파일 선택</Button><input ref={input} type="file" accept=".json" hidden aria-label="플러그인 파일" onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></div>}
    {draft && <div className="plugin-preview"><b>{draft.name} · {draft.version}</b><p>{draft.description}</p><p>권한: {draft.permissions.map(p => permissionLabels[p]).join(', ') || '없음'}</p><p>외부 연결: {draft.connect.join(', ') || '없음'}</p><div className="plugin-actions"><Button disabled={busy} variant="primary" onClick={() => void run(async () => { await api('/admin/plugins', { method: 'POST', body: { ...draft } }); setDraft(null); })}>설치·업데이트</Button><Button disabled={busy} onClick={() => setDraft(null)}>취소</Button></div></div>}
    {shown.map(plugin => <div className="setting plugin-row" key={plugin.id}><div><b>{plugin.name} <small>{plugin.version}</small></b><small>{plugin.description}</small></div><div className="plugin-actions">
      {plugin.enabled && plugin.placements.includes('settings') && <Button onClick={() => setOpened(plugin)}>열기</Button>}
      {admin && <><button role="switch" aria-label={`${plugin.name} 사용`} aria-checked={plugin.enabled} className={`switch ${plugin.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => void run(() => api(`/admin${path(plugin.id)}`, { method: 'PATCH', body: { enabled: !plugin.enabled } }))}><i /></button><Button disabled={busy} onClick={() => { if (confirm(`${plugin.name} 플러그인을 삭제할까요?`)) void run(() => api(`/admin${path(plugin.id)}`, { method: 'DELETE' })); }}>삭제</Button></>}
    </div></div>)}
    {!shown.length && <p className="plugin-empty">설치된 플러그인이 없습니다.</p>}
    {(error || plugins.isError) && <p className="plugin-empty form-error" role="alert">{error || '플러그인 목록을 불러오지 못했어요.'}</p>}
  </div>{opened && <PluginWindow key={opened.id} plugin={opened} onClose={() => setOpened(null)} />}</section>;
}
