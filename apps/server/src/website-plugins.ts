import { compatibilityHttp } from '@moa/extensions';
import type { WebsitePlugin, WebsitePluginPackage } from '@moa/shared';
import type { FastifyInstance } from 'fastify';
import type { Store } from './db.js';
import { ApiFailure, hash } from './util.js';

export function pluginPackage(value: unknown): WebsitePluginPackage {
  const p = value as WebsitePluginPackage;
  const list = (items: unknown, allowed: string[]) => Array.isArray(items) && items.length <= allowed.length && new Set(items).size === items.length && items.every(item => allowed.includes(item));
  if (!p || typeof p !== 'object' || Object.keys(p).some(key => !['apiVersion', 'id', 'name', 'version', 'description', 'placements', 'permissions', 'connect', 'html'].includes(key)) ||
    p.apiVersion !== 1 || typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 ||
    typeof p.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(p.version) || p.version.length > 40 ||
    typeof p.description !== 'string' || p.description.length > 500 || !list(p.placements, ['settings', 'player']) || !p.placements.length ||
    !list(p.permissions, ['player.context', 'subtitles.import']) || !Array.isArray(p.connect) || p.connect.length > 10 || new Set(p.connect).size !== p.connect.length ||
    typeof p.html !== 'string' || !p.html.trim() || Buffer.byteLength(p.html) > 200 * 1024) throw new ApiFailure(400, 'invalid-plugin');
  for (const origin of p.connect) {
    try {
      const url = new URL(origin);
      if (typeof origin !== 'string' || origin.length > 250 || url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error();
    } catch { throw new ApiFailure(400, 'invalid-plugin-origin'); }
  }
  return p;
}

export function registerWebsitePlugins(app: FastifyInstance, db: Store) {
  db.db.exec('CREATE TABLE IF NOT EXISTS website_plugins(id TEXT PRIMARY KEY,package TEXT NOT NULL,enabled INTEGER NOT NULL)');
  const metadata = (row: Record<string, any>): WebsitePlugin => { const { html, ...p } = JSON.parse(row.package) as WebsitePluginPackage; return { ...p, revision: hash(row.package), enabled: Boolean(row.enabled) }; };
  const get = (id: string, enabled = true) => {
    const row = db.get('SELECT * FROM website_plugins WHERE id=?', id);
    if (!row || enabled && !row.enabled) throw new ApiFailure(404, 'plugin-not-found');
    return row;
  };
  const pending = new Set<string>(), abort = new AbortController();
  app.addHook('onClose', async () => abort.abort());
  app.get('/api/plugins', async req => db.all(`SELECT * FROM website_plugins ${req.moaAccount.role === 'admin' ? '' : 'WHERE enabled=1'} ORDER BY id`).map(metadata));
  app.get('/api/plugins/:id', async req => { const row = get((req.params as { id: string }).id); return { ...JSON.parse(row.package), revision: hash(row.package) }; });
  app.post('/api/admin/plugins', { bodyLimit: 256 * 1024 }, async req => {
    const p = pluginPackage(req.body);
    if (!db.get('SELECT 1 FROM website_plugins WHERE id=?', p.id) && db.get('SELECT count(*) AS n FROM website_plugins')!.n >= 32) throw new ApiFailure(409, 'plugin-limit');
    db.run('INSERT INTO website_plugins VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET package=excluded.package', p.id, JSON.stringify(p));
    return metadata(get(p.id, false));
  });
  app.patch('/api/admin/plugins/:id', { schema: { body: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: { type: 'boolean' } } } } }, async req => {
    const id = (req.params as { id: string }).id; get(id, false);
    db.run('UPDATE website_plugins SET enabled=? WHERE id=?', Number((req.body as { enabled: boolean }).enabled), id);
    return metadata(get(id, false));
  });
  app.delete('/api/admin/plugins/:id', async (req, reply) => { db.run('DELETE FROM website_plugins WHERE id=?', (req.params as { id: string }).id); return reply.code(204).send(); });
  app.post('/api/plugins/:id/request', { schema: { body: { type: 'object', additionalProperties: false, required: ['url', 'revision'], properties: { url: { type: 'string', maxLength: 2048 }, revision: { type: 'string', pattern: '^[a-f0-9]{32}$' } } } } }, async req => {
    const id = (req.params as { id: string }).id, row = get(id), p = JSON.parse(row.package) as WebsitePluginPackage;
    const { url: raw, revision } = req.body as { url: string; revision: string };
    if (hash(row.package) !== revision) throw new ApiFailure(409, 'plugin-updated');
    let url: URL;
    try { url = new URL(raw); } catch { throw new ApiFailure(400, 'plugin-url-invalid'); }
    if (url.username || url.password || !p.connect.includes(url.origin)) throw new ApiFailure(403, 'plugin-origin-denied');
    const key = `${req.moaProfile}:${id}`;
    if (pending.has(key) || pending.size >= 4) throw new ApiFailure(429, 'plugin-busy');
    pending.add(key);
    try {
      const result = await compatibilityHttp({ url: url.href, method: 'GET', options: { timeout: 15, followRedirects: false } }, abort.signal, [], 4 * 1024 * 1024, undefined, false);
      if (result.statusCode < 200 || result.statusCode >= 300) throw new ApiFailure(502, 'plugin-fetch-failed');
      if (hash(get(id).package) !== revision) throw new ApiFailure(409, 'plugin-updated');
      return { base64: Buffer.from(result.bytes).toString('base64') };
    } catch (error) { if (error instanceof ApiFailure) throw error; throw new ApiFailure(502, 'plugin-fetch-failed'); }
    finally { pending.delete(key); }
  });
}
