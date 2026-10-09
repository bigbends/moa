import type { Store } from './db.js';

/** Only numbered mirrors in the source's own hostname family share an identity.
 * Query and fragment can identify episodes; keep them verbatim. No title matching.
 */
export function sourceIdentity(url: string, base: string): string {
  if (typeof url !== 'string' || url.trim().startsWith('{') || url.trim().startsWith('[')) return JSON.stringify(['opaque',url]);
  try {
    const anchor = new URL(base), target = new URL(url, anchor);
    const family = (host: string) => host.toLowerCase().replace(/\d+(?=\.)/, '{n}');
    if (!/^https?:$/.test(target.protocol) || target.username || target.password ||
        target.port !== anchor.port || family(target.hostname) !== family(anchor.hostname)) return JSON.stringify(['opaque', url]);
    return JSON.stringify(['site', family(target.hostname), target.port, target.pathname, target.search, target.hash]);
  } catch { return JSON.stringify(['opaque', url]); }
}

// Only absolute navigation URLs are rewritten. Relative and opaque IDs belong to
// the extension. A higher suffix is selected only when supplied by that source.
function numberedOrigin(value: string) {
  if (!/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value), match = /\d+(?=\.)/.exec(url.hostname);
    if (!match || url.username || url.password) return undefined;
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number)) return undefined;
    return { origin: url.origin, family: url.hostname.replace(/\d+(?=\.)/, '{n}') + ':' + url.port, number };
  } catch { return undefined; }
}

export class SourceIdentities {
  constructor(private db: Store) {
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS source_domain_origin(source_id TEXT NOT NULL REFERENCES source_entries(id) ON DELETE CASCADE,family TEXT NOT NULL,origin TEXT NOT NULL,PRIMARY KEY(source_id,family));
      CREATE TABLE IF NOT EXISTS source_work_identity(media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,source_id TEXT NOT NULL,identity TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_work_identity_lookup ON source_work_identity(source_id,identity);
      CREATE TABLE IF NOT EXISTS source_episode_identity(episode_id TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,media_id TEXT NOT NULL,identity TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_episode_identity_lookup ON source_episode_identity(media_id,identity);`);
    // Backfill mappings only. Existing IDs/progress/watchlists are never rewritten.
    db.transaction(() => {
      for (const row of db.all(`SELECT m.media_id,m.source_id,m.url,s.installed_entry,s.entry FROM source_media m JOIN source_entries s ON s.id=m.source_id LEFT JOIN source_work_identity i ON i.media_id=m.media_id WHERE i.media_id IS NULL`)) {
        let base='';try{base=JSON.parse(row.installed_entry||row.entry).baseUrl||'';}catch{}
        this.work(row.source_id,row.media_id,row.url,base);
      }
      for (const row of db.all(`SELECT x.episode_id,x.url,e.media_id,s.installed_entry,s.entry FROM source_episodes x JOIN episodes e ON e.id=x.episode_id JOIN source_media m ON m.media_id=e.media_id JOIN source_entries s ON s.id=m.source_id LEFT JOIN source_episode_identity i ON i.episode_id=x.episode_id WHERE i.episode_id IS NULL`)) {
        let base='';try{base=JSON.parse(row.installed_entry||row.entry).baseUrl||'';}catch{}
        this.episode(row.media_id,row.episode_id,row.url,base);
      }
      // Also seed known origins when upgrading a database that already has IDs.
      for (const row of db.all('SELECT m.source_id,m.url,s.installed_entry,s.entry FROM source_media m JOIN source_entries s ON s.id=m.source_id')) {
        try { this.observeOrigin(row.source_id,row.url,JSON.parse(row.installed_entry || row.entry).baseUrl); } catch {}
      }
    });
  }
  private observeOrigin(source: string, value: string, base: string) {
    const anchor=numberedOrigin(base), candidate=numberedOrigin(value);
    if (!anchor || !candidate || candidate.family!==anchor.family) return;
    const saved=this.db.get('SELECT origin FROM source_domain_origin WHERE source_id=? AND family=?',source,anchor.family);
    const previous=saved && numberedOrigin(saved.origin);
    if (!previous || candidate.number>previous.number) this.db.run('INSERT OR REPLACE INTO source_domain_origin VALUES(?,?,?)',source,anchor.family,candidate.origin);
  }
  navigationUrl(source: string, value: string, base: string): string {
    const target=numberedOrigin(value), anchor=numberedOrigin(base);
    if (!target || !anchor || target.family!==anchor.family) return value;
    this.observeOrigin(source,base,base);
    const saved=this.db.get('SELECT origin FROM source_domain_origin WHERE source_id=? AND family=?',source,anchor.family);
    const next=saved && numberedOrigin(saved.origin);
    if (!next || next.number<=target.number || value.startsWith('https:') && next.origin.startsWith('http:')) return value;
    // Preserve the original path/query/fragment bytes, including signed values.
    return value.replace(/^https?:\/\/[^/?#]+/i,next.origin);
  }
  findWork(source: string, url: string, base: string): string | undefined {
    const rows=this.db.all('SELECT media_id FROM source_work_identity WHERE source_id=? AND identity=? LIMIT 2',source,sourceIdentity(url,base));
    return rows.length===1?rows[0].media_id:undefined;
  }
  findEpisode(media: string, url: string, base: string): string | undefined {
    const rows=this.db.all('SELECT episode_id FROM source_episode_identity WHERE media_id=? AND identity=? LIMIT 2',media,sourceIdentity(url,base));
    return rows.length===1?rows[0].episode_id:undefined;
  }
  work(source:string,media:string,url:string,base:string){this.observeOrigin(source,url,base);this.db.run('INSERT OR REPLACE INTO source_work_identity VALUES(?,?,?)',media,source,sourceIdentity(url,base));}
  episode(media:string,episode:string,url:string,base:string){this.db.run('INSERT OR REPLACE INTO source_episode_identity VALUES(?,?,?)',episode,media,sourceIdentity(url,base));}
}
