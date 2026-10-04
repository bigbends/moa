export function parseRepository(bytes, repository) {
  let base;
  try { if (typeof repository !== 'string' || !repository) throw new Error(); base = new URL(repository); }
  catch { throw new Error('apk_repository_invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.hash) throw new Error('apk_repository_invalid');
  if (bytes.length > 4 * 1024 * 1024) throw new Error('apk_index_limit');
  const rows = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('apk_index_invalid');
  const used = new Set();
  return rows.map(row => {
    if (!row || typeof row.pkg !== 'string' || !/^[A-Za-z]\w*(?:\.[A-Za-z]\w*)+$/.test(row.pkg) || row.pkg.length > 256 || used.has(row.pkg) ||
      !Number.isSafeInteger(row.code) || row.code < 1 || typeof row.version !== 'string' || row.version.length > 64 ||
      typeof row.apk !== 'string' || !/^[\w.-]+\.apk$/.test(row.apk) || row.apk.includes('..') ||
      typeof row.name !== 'string' || row.name.length > 512 || !Array.isArray(row.sources) || row.sources.length > 1000 ||
      new Set(row.sources.map(s => s.id)).size !== row.sources.length || row.sources.some(s => !s || typeof s.id !== 'string' || !/^[1-9]\d{0,18}$/.test(s.id) || BigInt(s.id) > 9223372036854775807n || typeof s.name !== 'string' || s.name.length > 512 || typeof s.lang !== 'string' || s.lang.length > 32)) throw new Error('apk_index_invalid');
    used.add(row.pkg);
    return { ...row, apkUrl: new URL('apk/' + row.apk, base).href, supportedVersion: /^(?:14|16)\.\d+$/.test(row.version) };
  });
}
