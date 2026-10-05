import { createHash, randomUUID } from 'node:crypto';
import type { SavedSubtitle, SubtitleTrack } from '@moa/shared';
import type { Store } from './db.js';
import type { Catalog } from './catalog.js';
import type { Translations } from './translation/service.js';
import type { OnlineSubtitles } from './online.js';
import { importSubtitles } from './subtitle-upload.js';
import { ApiFailure } from './util.js';

interface Upload { id: string; episode_id: string; profile_id: string; filename: string; format: 'ass' | 'vtt'; content: string }

export class SubtitleLibrary {
  constructor(private db: Store, private catalog: Catalog, private translations: Translations, private online: OnlineSubtitles) {
    db.db.exec(`CREATE TABLE IF NOT EXISTS uploaded_subtitles(
      id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,filename TEXT NOT NULL,
      format TEXT NOT NULL,content TEXT NOT NULL,content_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
      UNIQUE(episode_id,profile_id,content_hash));`);
  }

  private episode(episodeId: string, profileId: string) {
    const episode = this.db.get('SELECT media_id FROM episodes WHERE id=?', episodeId);
    if (!episode) throw new ApiFailure(404, 'episode-not-found');
    if (!this.db.get('SELECT 1 FROM profiles WHERE id=?', profileId)) throw new ApiFailure(401, 'profile-required');
    this.catalog.kids.assert(episode.media_id, profileId);
  }

  private track(row: Upload): SubtitleTrack {
    return { id: `upload-${row.id}`, label: row.filename, source: 'upload', format: row.format, url: `/api/playback/upload-${row.id}/subtitles/${row.id}.${row.format}` };
  }

  async import(episodeId: string, profileId: string, filename: string, data: string) {
    this.episode(episodeId, profileId);
    const files = await importSubtitles(filename, data), tracks: SubtitleTrack[] = [];
    this.db.transaction(() => {
      this.episode(episodeId, profileId);
      for (const file of files) {
        const digest = createHash('sha256').update(file.content).digest('hex');
        this.db.run('INSERT OR IGNORE INTO uploaded_subtitles VALUES(?,?,?,?,?,?,?,?)', randomUUID(), episodeId, profileId, file.filename, file.format, file.content, digest, Date.now());
        tracks.push(this.track(this.db.get<Upload>('SELECT * FROM uploaded_subtitles WHERE episode_id=? AND profile_id=? AND content_hash=?', episodeId, profileId, digest)!));
      }
    });
    return [...new Map(tracks.map(track => [track.id, track])).values()];
  }

  uploads(episodeId: string, profileId: string) {
    this.episode(episodeId, profileId);
    return this.db.all<Upload>('SELECT id,filename,format FROM uploaded_subtitles WHERE episode_id=? AND profile_id=? ORDER BY created_at DESC,id', episodeId, profileId).map(row => this.track(row));
  }

  assetProfile(sessionId: string) {
    return sessionId.startsWith('upload-') ? this.db.get('SELECT profile_id FROM uploaded_subtitles WHERE id=?', sessionId.slice(7))?.profile_id as string | undefined : undefined;
  }

  asset(sessionId: string, track: string, profileId?: string) {
    if (!sessionId.startsWith('upload-')) return undefined;
    const row = this.db.get<Upload>('SELECT * FROM uploaded_subtitles WHERE id=?', sessionId.slice(7));
    if (!row || track !== `${row.id}.${row.format}`) throw new ApiFailure(404, 'subtitle-not-found');
    if (profileId !== undefined && profileId !== row.profile_id) throw new ApiFailure(403, 'session-profile-mismatch');
    this.episode(row.episode_id, row.profile_id);
    return row;
  }

  list(): SavedSubtitle[] {
    const uploads = this.db.all<SavedSubtitle>(`SELECT s.id,'upload' AS source,s.filename AS name,s.format,
      m.title AS title,p.name AS profile,length(CAST(s.content AS BLOB)) AS bytes,s.created_at AS createdAt,1 AS complete
      FROM uploaded_subtitles s JOIN episodes e ON e.id=s.episode_id JOIN media m ON m.id=e.media_id JOIN profiles p ON p.id=s.profile_id`);
    const translations = this.db.all<SavedSubtitle>(`SELECT c.key AS id,'translation' AS source,'한국어 AI 번역' AS name,c.format,
      COALESCE(group_concat(DISTINCT m.title),'AI 번역') AS title,NULL AS profile,length(CAST(c.content AS BLOB)) AS bytes,
      COALESCE(max(s.created_at),c.touched) AS createdAt,c.complete
      FROM translation_cache c LEFT JOIN translated_subtitles s ON s.cache_key=c.key LEFT JOIN episodes e ON e.id=s.episode_id
      LEFT JOIN media m ON m.id=e.media_id WHERE c.content IS NOT NULL GROUP BY c.key`);
    const online = this.db.all<SavedSubtitle>(`SELECT s.id,'online' AS source,s.creator_name || ' · 한국어' AS name,s.format,
      m.title AS title,NULL AS profile,length(CAST(s.content AS BLOB)) AS bytes,s.created_at AS createdAt,1 AS complete
      FROM online_subtitles s JOIN episodes e ON e.id=s.episode_id JOIN media m ON m.id=e.media_id`);
    return [...uploads, ...translations, ...online].map(row => ({ ...row, complete: Boolean(row.complete) })).sort((a, b) => b.createdAt - a.createdAt);
  }

  content(source: SavedSubtitle['source'], id: string) {
    const row = source === 'upload'
      ? this.db.get<{ name: string; format: 'ass' | 'vtt'; content: string }>('SELECT filename AS name,format,content FROM uploaded_subtitles WHERE id=?', id)
      : source === 'online'
        ? this.db.get<{ name: string; format: 'ass' | 'vtt'; content: string }>("SELECT creator_name || ' · 한국어' AS name,format,content FROM online_subtitles WHERE id=?", id)
        : this.db.get<{ name: string; format: 'ass' | 'vtt'; content: string }>("SELECT '한국어 AI 번역' AS name,format,content FROM translation_cache WHERE key=? AND content IS NOT NULL", id);
    if (!row) throw new ApiFailure(404, 'subtitle-not-found');
    return row;
  }

  remove(source: SavedSubtitle['source'], id: string) {
    this.content(source, id);
    if (source === 'translation') this.translations.removeSaved(id);
    else if (source === 'online') this.online.remove(this.db.get('SELECT episode_id FROM online_subtitles WHERE id=?', id)!.episode_id, id);
    else this.db.run('DELETE FROM uploaded_subtitles WHERE id=?', id);
  }
}
