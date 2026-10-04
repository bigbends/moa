// Compatibility entry point: verify the synthetic offline catalogs.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
for (const script of ['audit-search-grouping.ts', 'audit-franchise-seasons.ts']) {
  execFileSync('corepack', ['pnpm', 'exec', 'tsx', `scripts/${script}`], { cwd, stdio: 'inherit' });
}
