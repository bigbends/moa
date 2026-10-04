// Find mock episodes by catalog shape so scripts do not depend on title-specific IDs.
export async function mockWatchUrl(page, base, type, number = 1) {
  if (new URL(page.url()).origin !== new URL(base).origin) await page.goto(base);
  const episodeId = await page.evaluate(async ({ type, number }) => {
    const media = await fetch('/api/media').then(response => response.json());
    const card = media.items.find(item => item.type === type && item.provider?.kind === 'local');
    if (!card) throw new Error('Missing local mock catalog fixture');
    const detail = await fetch(`/api/media/${card.id}`).then(response => response.json());
    const episode = detail.seasons.flatMap(season => season.episodes).find(episode => episode.number === number);
    if (!episode) throw new Error('Missing mock episode');
    return episode.id;
  }, { type, number });
  return `${base}/watch/${episodeId}`;
}
