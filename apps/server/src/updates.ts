import { readFile, writeFile, link, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { UpdateStatus } from '@moa/shared';
import { ApiFailure } from './util.js';

export class Updates {
  constructor(private dir = process.env.MOA_UPDATER_DIR) {}
  async status(): Promise<UpdateStatus> {
    const base: UpdateStatus = { configured: Boolean(this.dir), connected: false, state: 'idle', mode: process.env.MOA_DEPLOYMENT === 'docker' ? 'docker' : process.env.MOA_DEPLOYMENT === 'git' ? 'git' : null, current: process.env.MOA_REVISION || 'unknown', latest: null, branch: null, behind: 0, ahead: 0, checkedAt: null, error: null };
    if (!this.dir) return base;
    try {
      const content = await readFile(path.join(this.dir, 'status.json'), 'utf8');
      if (content.length > 16384) throw new Error();
      const data = JSON.parse(content);
      if (!['idle', 'checking', 'updating', 'current', 'available', 'blocked', 'failed', 'restart-required'].includes(data.state) || ![null, 'git', 'docker'].includes(data.mode)) throw new Error();
      const text = (value: unknown) => typeof value === 'string' && value.length <= 256 ? value : null;
      return { ...base, connected: data.connected === true && Number.isFinite(data.heartbeat) && Math.abs(Date.now() - data.heartbeat) < 15000, state: data.state, mode: data.mode,
        current: text(data.current) || base.current, latest: text(data.latest), branch: text(data.branch), behind: Number.isSafeInteger(data.behind) && data.behind >= 0 ? data.behind : 0, ahead: Number.isSafeInteger(data.ahead) && data.ahead >= 0 ? data.ahead : 0,
        checkedAt: Number.isSafeInteger(data.checkedAt) ? data.checkedAt : null, error: typeof data.error === 'string' && /^update-[a-z-]+$/.test(data.error) ? data.error : null };
    } catch { return { ...base, error: 'updater-unavailable' }; }
  }
  async request(action: 'check' | 'apply') {
    const status = await this.status();
    if (!this.dir || !status.connected) throw new ApiFailure(503, 'updater-unavailable');
    if (['checking', 'updating'].includes(status.state)) throw new ApiFailure(409, 'update-busy');
    if (action === 'apply' && status.state !== 'available') throw new ApiFailure(409, 'update-not-available');
    const file = path.join(this.dir, 'request.json');
    const temp = path.join(this.dir, `request-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify({ id: randomUUID(), action, createdAt: Date.now() }), { flag: 'wx', mode: 0o660 });
      await link(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiFailure(409, 'update-busy');
      throw new ApiFailure(503, 'updater-unavailable');
    } finally { await rm(temp, { force: true }).catch(() => {}); }
    return { ...status, state: action === 'check' ? 'checking' as const : 'updating' as const };
  }
}

export function registerUpdates(app: FastifyInstance) {
  const updates = new Updates();
  app.get('/api/admin/updates', async (_req, reply) => reply.header('Cache-Control', 'private, no-store').send(await updates.status()));
  for (const action of ['check', 'apply'] as const) app.post(`/api/admin/updates/${action}`, async (req, reply) => {
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw new ApiFailure(400, 'invalid-update-request');
    return reply.code(202).header('Cache-Control', 'private, no-store').send(await updates.request(action));
  });
}
