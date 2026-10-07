import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Updater } from './update.mjs';

test('Git updates the tracked branch, refuses tracked changes and divergence, and retries failed builds', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moa-update-'));
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const remote = path.join(dir, 'remote.git'), source = path.join(dir, 'source'), local = path.join(dir, 'local');
    git(dir, 'init', '--bare', remote);
    git(dir, 'clone', remote, source);
    await writeFile(path.join(source, 'content'), 'one');
    git(source, 'add', '.'); git(source, 'commit', '-m', 'Initial');
    git(source, 'branch', '-M', 'feature'); git(source, 'push', '-u', 'origin', 'feature');
    git(dir, 'clone', '-b', 'feature', remote, local);
    const updater = new Updater({ cwd: local, dir: path.join(dir, 'state'), mode: 'git' });
    const originalRun = updater.run;
    const commands = [];
    let broken = false;
    updater.run = async (command, args, timeout) => {
      commands.push([command, ...args]);
      if (command === 'corepack') { if (broken) throw new Error('sensitive build output'); return ''; }
      return originalRun(command, args, timeout);
    };
    assert.equal((await updater.perform('check')).state, 'current');
    await writeFile(path.join(source, 'content'), 'two');
    git(source, 'commit', '-am', 'Second'); git(source, 'push');
    const target = git(source, 'rev-parse', 'HEAD');
    assert.equal((await updater.perform('check')).state, 'available');
    assert.equal(updater.state.branch, 'feature');
    await writeFile(path.join(local, 'content'), 'local edit');
    assert.equal((await updater.perform('apply')).error, 'update-dirty');
    assert.notEqual(git(local, 'rev-parse', 'HEAD'), target);
    git(local, 'checkout', '--', 'content');
    await writeFile(path.join(local, '.DS_Store'), 'unrelated');
    broken = true;
    assert.equal((await updater.perform('apply')).error, 'update-build-failed');
    assert.equal(git(local, 'rev-parse', 'HEAD'), target);
    assert.equal((await updater.perform('check')).state, 'available');
    broken = false;
    assert.equal((await updater.perform('apply')).state, 'restart-required');
    assert.equal(updater.state.current, target);
    assert.equal((await updater.perform('check')).state, 'restart-required');
    assert.equal(await readFile(path.join(local, '.DS_Store'), 'utf8'), 'unrelated');
    assert.ok(commands.some(value => value.join(' ') === 'corepack pnpm install --frozen-lockfile'));
    await writeFile(path.join(local, 'local-feature'), 'local');
    git(local, 'add', 'local-feature'); git(local, 'commit', '-m', 'Local');
    await writeFile(path.join(source, 'remote-feature'), 'remote');
    git(source, 'add', 'remote-feature'); git(source, 'commit', '-m', 'Remote'); git(source, 'push');
    assert.equal((await updater.perform('apply')).error, 'update-diverged');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Docker compares running image IDs and recreates without deleting volumes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moa-update-docker-'));
  const commands = [];
  let installed = false, apk = false;
  const updater = new Updater({ cwd: dir, dir: path.join(dir, 'state'), mode: 'docker', run: async (command, args) => {
    commands.push([command, ...args]);
    if (command === 'git') throw new Error();
    if (args[0] === 'inspect') return installed ? 'sha256:new' : 'sha256:old';
    if (args[0] === 'image') return 'sha256:new';
    if (args[1] === 'config') return JSON.stringify({ services: { moa: { image: 'ghcr.io/sidetool/moa:latest' }, 'moa-apk': { image: 'ghcr.io/sidetool/moa-apk:latest', profiles: ['apk'] } } });
    if (args[1] === 'ps') return JSON.stringify([{ Service: 'moa', ID: 'container' }, ...(apk ? [{ Service: 'moa-apk', ID: 'apk' }] : [])]);
    if (args[1] === 'up') installed = true;
    return '';
  } });
  try {
    assert.equal((await updater.perform('check')).state, 'available');
    assert.equal(updater.state.current, 'sha256:old');
    assert.equal((await updater.perform('apply')).state, 'current');
    assert.equal(updater.state.current, 'sha256:new');
    assert.equal((await updater.perform('check')).state, 'current');
    assert.ok(commands.some(value => value.includes('up') && value.includes('--wait')));
    assert.ok(commands.every(value => !value.includes('down') && !value.includes('--volumes')));
    assert.ok(commands.every(value => !value.includes('moa-apk') && !value.includes('ghcr.io/sidetool/moa-apk:latest')));
    apk = true;
    assert.equal((await updater.perform('check')).state, 'current');
    assert.ok(commands.some(value => value.includes('pull') && value.includes('moa-apk')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('host agent rejects expired or extended requests without running commands', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moa-update-request-'));
  let calls = 0;
  const updater = new Updater({ dir, run: async () => { calls++; return ''; } });
  try {
    for (const request of [
      { id: '00000000-0000-0000-0000-000000000000', action: 'apply', createdAt: 0 },
      { id: '00000000-0000-0000-0000-000000000000', action: 'check', createdAt: Date.now(), command: 'rm' },
    ]) {
      await writeFile(path.join(dir, 'request.json'), JSON.stringify(request));
      await updater.consume();
      assert.equal(updater.state.error, 'update-request-invalid');
    }
    assert.equal(calls, 0);
    assert.throws(() => new Updater({ service: 'moa.service;exit' }), /update-invalid-options/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('source-based Docker updates build the fork and retry before replacing running containers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moa-update-source-'));
  const root = await realpath(dir), old = 'a'.repeat(40), latest = 'b'.repeat(40), commands = [];
  let current = old, deployed = old, broken = true, divergent = false;
  const updater = new Updater({ cwd: root, dir: path.join(root, 'state'), mode: 'docker', run: async (command, args) => {
    commands.push([command, ...args]);
    if (command === 'git') {
      if (args.includes('--show-toplevel')) return root;
      if (args[0] === 'symbolic-ref') return 'feature';
      if (args[0] === 'config') return args[1].endsWith('.remote') ? 'origin' : 'refs/heads/feature';
      if (args[0] === 'rev-parse') return args.at(-1) === 'HEAD' ? current : latest;
      if (args[0] === 'rev-list') return current === latest ? '0\t0' : '0\t1';
      if (args[0] === 'merge-base' && divergent) throw new Error();
      if (args[0] === 'merge') current = latest;
      return '';
    }
    if (args[0] === 'inspect') return deployed;
    if (args[1] === 'ps') return 'container';
    if (args[1] === 'build' && broken) throw new Error('private registry information');
    if (args[1] === 'up') deployed = latest;
    return '';
  } });
  try {
    assert.equal((await updater.perform('apply')).error, 'update-docker-failed');
    assert.equal(deployed, old);
    assert.ok(commands.every(value => !value.includes('pull') && !value.includes('up')));
    broken = false;
    assert.equal((await updater.perform('apply')).state, 'current');
    assert.equal(deployed, latest);
    assert.ok(commands.some(value => value.includes(`MOA_REVISION=${latest}`)));
    assert.equal((await updater.perform('check')).state, 'current');
    deployed = 'c'.repeat(40); divergent = true;
    assert.equal((await updater.perform('apply')).error, 'update-deployment-diverged');
    deployed = 'unknown';
    assert.equal((await updater.perform('check')).error, 'update-version-unknown');
    assert.equal(updater.state.current, 'unknown');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('existing host installations periodically check without ever applying automatically', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moa-update-check-only-'));
  const updater = new Updater({ dir }); let checks = 0;
  updater.check = async () => { checks++; updater.state.state = 'available'; };
  updater.apply = async () => { assert.fail('automatic apply is not allowed'); };
  try {
    await updater.tick(); assert.equal(checks, 1);
    await updater.tick(); assert.equal(checks, 1);
    updater.nextCheckAt = 0;
    await updater.tick(); assert.equal(checks, 2);
    assert.equal(updater.state.state, 'available');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
