import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrateAccounts, transaction } from './accounts.mjs';

export function setupCode(db, regenerate = false) {
  db.exec('CREATE TABLE IF NOT EXISTS auth_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) {
      db.prepare("DELETE FROM auth_state WHERE key='setup-code'").run();
      return null;
    }
    let code = db.prepare("SELECT value FROM auth_state WHERE key='setup-code'").get()?.value;
    if (!code || regenerate) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      code = Array.from({length: 12}, () => alphabet[randomInt(alphabet.length)]).join('').match(/.{4}/g).join('-');
      db.prepare("INSERT OR REPLACE INTO auth_state VALUES('setup-code',?)").run(code);
    }
    return code;
  });
}
export function openState() {
  process.umask(0o077);
  const dir = process.env.DATA_DIR ?? '/data';
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(`${dir}/sessions.sqlite`);
  chmodSync(`${dir}/sessions.sqlite`, 0o600);
  let credentials;
  try { credentials = JSON.parse(readFileSync(process.env.CREDENTIALS_FILE ?? '/config/credentials.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  migrateAccounts(database, credentials ?? { users: [] }, Date.now);
  database.exec('CREATE TABLE IF NOT EXISTS auth_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  database.prepare("INSERT OR IGNORE INTO auth_state VALUES('csrf-secret',?)").run(credentials?.csrfSecret ?? randomBytes(32).toString('hex'));
  return { database, credentials: { users: [], csrfSecret: database.prepare("SELECT value FROM auth_state WHERE key='csrf-secret'").get().value } };
}
