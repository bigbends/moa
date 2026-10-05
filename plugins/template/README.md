# Subtitle helper plugin

This template adds a tool to MOA's settings and subtitle menu. It imports a local subtitle file or pasted subtitle text into the current episode. Imported subtitles use MOA's regular validation, conversion, profile ownership, and server storage.

## Build and install

From the repository root:

```sh
node plugins/template/build.mjs
```

In **Settings → Website plugins**, select `data/plugins/subtitle-helper.moa-plugin.json`, review its permissions, and choose **Install/update**. Open a video, then select **Subtitle and audio → Subtitle helper**. The settings entry explains where to open the tool when no video is playing.

## Change the template

- Edit `manifest.json` for the plugin ID, name, version, placements, and permissions.
- Edit `index.html` for the plugin interface and JavaScript.
- Run the build command again and install the resulting file. An existing plugin with the same ID is updated while its enabled setting is preserved.

The template requires no package installation or bundler. It is covered by the repository's GPL-3.0-or-later license. See the [plugin API documentation](../../docs/PLUGINS.md) for permissions, network requests, limits, and examples.
