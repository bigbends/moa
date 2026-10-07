// Run after publication. Older backports never move stable/beta aliases backwards.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { ReleaseFeed, SERVICES, compare } from './release.mjs';
const exec = promisify(execFile);
const tag = process.env.RELEASE_TAG, repository = process.env.GITHUB_REPOSITORY;
const feed = new ReleaseFeed({ repository });
const channel = tag.includes('-beta.') ? 'beta' : 'stable';
const published = await feed.releases(channel);
const newest = published[0]?.tag_name;
const owner = repository.split('/')[0].toLowerCase();
for (const name of SERVICES) {
  const image = `ghcr.io/${owner}/${name}`;
  const digest = (await readFile(`release-digests/${name}.txt`, 'utf8')).trim();
  const args = ['buildx', 'imagetools', 'create', '-t', `${image}:${tag}`];
  if (newest && compare(tag, newest) >= 0) {
    args.push('-t', `${image}:${channel}`);
    if (channel === 'stable') args.push('-t', `${image}:latest`);
  }
  await exec('docker', [...args, `${image}@${digest}`], { timeout: 120000 });
}
