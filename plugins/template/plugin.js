moa.on('ready', async context => {
  const bookmark = await moa.storage.get();
  if (context && bookmark.episodeId === context.episodeId) await moa.notify('A bookmark is available for this episode.');
});

moa.on('action', async ({ id }) => {
  const context = await moa.context();
  if (!context) throw new Error('Open a video first.');
  if (id === 'save') {
    await moa.storage.set({ episodeId: context.episodeId, time: context.currentTime });
    await moa.notify('Bookmark saved.');
  } else if (id === 'resume') {
    const bookmark = await moa.storage.get();
    if (bookmark.episodeId !== context.episodeId || !Number.isFinite(bookmark.time)) throw new Error('No bookmark for this episode.');
    await moa.player.seek(bookmark.time);
    await moa.player.play();
    await moa.notify('Resumed bookmark.');
  }
});
