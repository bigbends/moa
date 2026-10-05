# MOA plugin template

Create JavaScript plugins that run inside MOA. The default example saves a playback bookmark per profile, announces an available bookmark when an episode opens, and adds actions to save or resume playback. It needs no HTML interface, dependencies, or bundler.

## Build and install

Use Node.js 22 or later. From this template directory:

```sh
node build.mjs
```

In MOA, open **Plugins** from the profile menu, My page, or Settings link. As an administrator, select `dist/playback-bookmark.moa-plugin.json`, review its permissions, and choose **Install/update**. Open a video and use **Subtitle and audio → Save bookmark / Resume bookmark**. One bookmark is stored per profile and survives browser and server restarts.

When working inside the MOA repository, build with `node plugins/template/build.mjs` and use the output path it prints.

## Write a plugin

Edit `manifest.json` for the ID, version, placements, permissions, allowed HTTPS origins, and action labels. Edit `plugin.js` for behavior. MOA supplies `window.moa` before the script runs:

```js
moa.on('ready', async context => {
  if (context) await moa.notify(`Playing ${context.title}`);
});

moa.on('action', async ({ id }) => {
  if (id === 'pause') await moa.player.pause();
});
```

The example needs `player.context`, `notifications`, and `player.control` permissions and an action with ID `pause`. Rebuild after editing, then install the new package using the same ID to update it. Give a separate plugin its own ID. Scripts run automatically in their declared scope and should request only the permissions they use.

For automatic subtitle retrieval, declare `player.context` and `subtitles.import` and add your service's exact HTTPS origin to `connect`:

```js
moa.on('ready', async context => {
  if (!context) return;
  const url = new URL('/subtitle', 'https://subtitles.example.org');
  url.searchParams.set('title', context.title);
  const response = await moa.fetch(url.href);
  await moa.importSubtitles(new File([await response.arrayBuffer()], 'downloaded.srt'));
});
```

Replace the example endpoint with a service you operate or are permitted to use. MOA validates, converts, and saves imported subtitles through its regular upload path.

## HTML subtitle example

`examples/subtitle-helper` provides a file picker and text input for importing subtitles. Build it with:

```sh
node build.mjs examples/subtitle-helper
```

Install `dist/subtitle-helper.moa-plugin.json`. Open the tool in the player's subtitle and audio menu. The example shows the optional HTML interface; JavaScript plugins can import subtitles without opening a dialog.

## API and license

Read the [plugin API documentation](https://github.com/MixedSystem/moa-plugin-template/blob/main/docs/API.md) for events, methods, permissions, lifecycle, limits, and sandbox boundaries. The MOA repository also includes it at `docs/PLUGINS.md`.

This template is licensed under GPL-3.0-or-later, as is MOA. Include a license and explain every permission when distributing your plugin.
