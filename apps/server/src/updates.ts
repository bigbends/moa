import { readFile, writeFile, link, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { UpdateStatus, UpdatePolicy } from '@moa/shared';
import { ApiFailure } from './util.js';

export function validatePolicy(value: unknown): UpdatePolicy {
  const p = value as UpdatePolicy;
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).join() !== 'channel' || !['stable', 'beta'].includes(p.channel)) throw new ApiFailure(400, 'update-invalid-policy');
  return { channel: p.channel };
}
function releaseFields(data: Record<string, any>): Partial<UpdateStatus> {
  if (data.mode !== 'release') return {};
  let policy: UpdatePolicy | undefined;
  try { policy = validatePolicy(data.policy); } catch {}
  return {
    policy, updaterVersion: typeof data.updaterVersion === 'string' && /^\d+\.\d+\.\d+$/.test(data.updaterVersion) ? data.updaterVersion : undefined,
    nextCheckAt: Number.isSafeInteger(data.nextCheckAt) ? data.nextCheckAt : null,
    notesUrl: typeof data.notesUrl === 'string' && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\/v[0-9.]+(?:-beta\.\d+)?$/.test(data.notesUrl) ? data.notesUrl : null,
    history: Array.isArray(data.history) ? data.history.slice(0,20).filter(h => typeof h.version === 'string' && h.version.length < 80 && typeof h.previous === 'string' && h.previous.length < 80 && Number.isSafeInteger(h.at) && ['complete','rolled-back','failed'].includes(h.outcome)).map(h => ({ version: h.version, previous: h.previous, at: h.at, outcome: h.outcome })) : [],
  };
}

export class Updates {
  constructor(private dir = process.env.MOA_UPDATER_DIR) {}
  async status(): Promise<UpdateStatus> {
    const base: UpdateStatus = { configured: Boolean(this.dir), connected: false, state: 'idle', mode: process.env.MOA_DEPLOYMENT === 'release' ? 'release' : process.env.MOA_DEPLOYMENT === 'docker' ? 'docker' : process.env.MOA_DEPLOYMENT === 'git' ? 'git' : null, current: process.env.MOA_VERSION && process.env.MOA_VERSION !== 'unknown' ? process.env.MOA_VERSION : process.env.MOA_REVISION || 'unknown', latest: null, branch: null, behind: 0, ahead: 0, checkedAt: null, error: null };
    if (!this.dir) return base;
    try {
      const content = await readFile(path.join(this.dir, 'status.json'), 'utf8');
      if (content.length > 16384) throw new Error();
      const data = JSON.parse(content);
      if (!['idle', 'checking', 'updating', 'current', 'available', 'blocked', 'failed', 'restart-required', 'downloading', 'preflight', 'backup', 'applying', 'verifying', 'rolling-back', 'rolled-back', 'recovery-required'].includes(data.state) || ![null, 'git', 'docker', 'release'].includes(data.mode)) throw new Error();
      const text = (value: unknown) => typeof value === 'string' && value.length <= 256 ? value : null;
      return { ...base, ...releaseFields(data), connected: data.connected === true && Number.isFinite(data.heartbeat) && Math.abs(Date.now() - data.heartbeat) < 15000, state: data.state, mode: data.mode,
        current: text(data.current) || base.current, latest: text(data.latest), branch: text(data.branch), behind: Number.isSafeInteger(data.behind) && data.behind >= 0 ? data.behind : 0, ahead: Number.isSafeInteger(data.ahead) && data.ahead >= 0 ? data.ahead : 0,
        checkedAt: Number.isSafeInteger(data.checkedAt) ? data.checkedAt : null, error: typeof data.error === 'string' && /^update-[a-z-]+$/.test(data.error) ? data.error : null };
    } catch { return { ...base, error: 'updater-unavailable' }; }
  }
  async request(action: 'check' | 'apply' | 'configure', policy?: UpdatePolicy) {
    const status = await this.status();
    if (!this.dir || !status.connected) throw new ApiFailure(503, 'updater-unavailable');
    if (['checking', 'updating', 'downloading', 'preflight', 'backup', 'applying', 'verifying', 'rolling-back'].includes(status.state)) throw new ApiFailure(409, 'update-busy');
    if (action === 'apply' && status.state !== 'available') throw new ApiFailure(409, 'update-not-available');
    if (action === 'configure' && status.mode !== 'release') throw new ApiFailure(409, 'update-release-required');
    const file = path.join(this.dir, 'request.json');
    const temp = path.join(this.dir, `request-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify({ id: randomUUID(), action, createdAt: Date.now(), ...(action === 'configure' ? { policy: validatePolicy(policy) } : {}) }), { flag: 'wx', mode: 0o660 });
      await link(temp, file);
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ApiFailure(409, 'update-busy');
      throw new ApiFailure(503, 'updater-unavailable');
    } finally { await rm(temp, { force: true }).catch(() => {}); }
    return action === 'configure' ? status : { ...status, state: action === 'check' ? 'checking' as const : 'updating' as const };
  }
}

export function registerUpdates(app: FastifyInstance) {
  const updates = new Updates();
  app.get('/api/admin/updates', async (_req, reply) => reply.header('Cache-Control', 'private, no-store').send(await updates.status()));
  app.patch('/api/admin/updates/settings', async (req, reply) => reply.code(202).header('Cache-Control', 'private, no-store').send(await updates.request('configure', validatePolicy(req.body))));
  for (const action of ['check', 'apply'] as const) app.post(`/api/admin/updates/${action}`, async (req, reply) => {
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) throw new ApiFailure(400, 'invalid-update-request');
    return reply.code(202).header('Cache-Control', 'private, no-store').send(await updates.request(action));
  });
}
