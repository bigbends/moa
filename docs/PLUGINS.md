# Website plugins

Website plugins add JavaScript behavior and optional tools to MOA. They can react to playback, control the player, retrieve and import subtitles, store profile-specific data, and show notifications. They are separate from video-source extensions and do not register media catalogs or playback sources.

## Installation and management

Open **Plugins** from the profile menu, My page, or the Settings link. Administrators select a JSON package, review its permissions and allowed network origins, then install it. Administrators can update, disable, or delete packages; other profiles can use enabled plugins. The plugin list has its own page at `/plugins`.

Packages and plugin data are stored on the server. Updating an ID replaces its code while preserving its enabled setting and saved data. JavaScript instances restart when the package revision or profile changes. Disabling or deleting blocks subsequent SDK calls immediately; background instances disappear when the list refreshes, within 30 seconds. Deleting a plugin also deletes its profile data, but keeps subtitles it imported. HTML tools must be closed and reopened after updating.

JavaScript packages run automatically. Only install code from authors you trust: plugins can consume browser resources and use their declared permissions without opening a dialog.

## Package format

```json
{
  "apiVersion": 1,
  "id": "pause-tool",
  "name": "Pause tool",
  "version": "1.0.0",
  "description": "Pause playback from the subtitle menu.",
  "placements": ["player"],
  "permissions": ["player.control"],
  "connect": [],
  "actions": [{ "id": "pause", "label": "Pause playback" }],
  "script": "moa.on('action', async ({ id }) => { if (id === 'pause') await moa.player.pause(); });"
}
```

Use exactly one of `script` or `html`. All other fields except `actions` are required. Unknown fields and unsupported API versions are rejected. IDs contain 2–64 lowercase letters, digits, or hyphens and start with a letter. Versions use `major.minor.patch` with an optional prerelease suffix.

| Field | Behavior |
| --- | --- |
| `script` | Plain JavaScript executed once when its scope mounts. Bundle any dependencies into this string. |
| `html` | HTML, inline styles, and inline scripts shown in a dialog when the user opens the tool. |
| `placements: ["player"]` | JavaScript runs while a video is open. Actions and HTML tools appear under Subtitle and audio. |
| `placements: ["settings"]` | JavaScript runs across regular application pages outside the player. Actions and HTML tools appear on the Plugins page. The name is retained for package compatibility. |
| `placements: ["player", "settings"]` | Both scopes. A new instance starts when moving between them. |
| `actions` | Optional JavaScript-only buttons, each with a unique `id` and readable `label`. IDs start with a lowercase letter and contain up to 40 lowercase letters, digits, or hyphens. |
| `connect` | Exact HTTPS origins the plugin may request through `moa.fetch`. |

A script instance survives opening and closing the subtitle menu. It is destroyed when leaving its scope, changing profile or episode, updating the package, or observing disable/deletion. Timers and event listeners inside the iframe disappear with it. Persist durable data through `moa.storage`.

## Events and SDK

MOA supplies `window.moa` before plugin code runs. SDK methods return promises and reject on invalid input, missing permission, revoked access, or a failed request. Handle errors in normal method calls. Rejected event handlers are reported as a plugin notification.

| Method | Permission | Result |
| --- | --- | --- |
| `moa.context()` | `player.context` | `{ episodeId, title, currentTime }`, or `null` outside the player |
| `moa.player.play()` | `player.control` | Starts playback; browser autoplay restrictions may still reject it |
| `moa.player.pause()` | `player.control` | Pauses playback |
| `moa.player.seek(seconds)` | `player.control` | Seeks within the video's duration; unavailable for live playback |
| `moa.importSubtitles(file)` | `subtitles.import` | `true` after importing and storing subtitles on the server |
| `moa.storage.get()` | `storage` | This plugin's saved JSON object for the active profile, initially `{}` |
| `moa.storage.set(object)` | `storage` | Replaces and returns that object's saved value; concurrent writes use the last completed write |
| `moa.notify(text)` | `notifications` | Displays a plain-text notification labeled with the plugin name |
| `moa.fetch(url)` | Exact HTTPS origin in `connect` | A browser `Response` containing downloaded bytes |
| `moa.on(event, handler)` | Depends on event | Registers a handler and returns an unsubscribe function |

Register event handlers synchronously at the top level of `plugin.js` so they receive the first `ready` event.

| Event | Payload | Delivery |
| --- | --- | --- |
| `ready` | Playback context when granted and available; otherwise `null` | Once after the host connects |
| `timeupdate` | Playback context | About once per second in the player with `player.context` permission |
| `action` | `{ id }` | When the user clicks a declared action |

The context contains the episode ID, display title, and position in seconds. It does not expose source credentials, video URLs, account details, or API keys. Permissions are enforced by the host, even when a plugin calls a method directly.

### Save and restore a position

Declare `player.context`, `player.control`, `storage`, and `notifications` and actions named `save` and `resume`:

```js
moa.on('action', async ({ id }) => {
  const context = await moa.context();
  if (!context) throw new Error('Open a video first');
  if (id === 'save') {
    await moa.storage.set({ episodeId: context.episodeId, time: context.currentTime });
    await moa.notify('Position saved');
  } else if (id === 'resume') {
    const saved = await moa.storage.get();
    if (saved.episodeId !== context.episodeId || !Number.isFinite(saved.time)) return;
    await moa.player.seek(saved.time);
    await moa.player.play();
  }
});
```

### Retrieve subtitles automatically

Declare `player.context` and `subtitles.import`, and add your service's exact origin to `connect`:

```json
"connect": ["https://subtitles.example.org"]
```

```js
moa.on('ready', async context => {
  if (!context) return;
  const url = new URL('/download', 'https://subtitles.example.org');
  url.searchParams.set('title', context.title);
  const response = await moa.fetch(url.href);
  await moa.importSubtitles(new File([await response.arrayBuffer()], 'downloaded.srt'));
});
```

Replace the example URL with a real service. Import requires an open player. Supported files are SRT, VTT, VVT, ASS, SSA, SMI, SAMI, ZIP, 7z, and RAR. A single imported subtitle is selected automatically; archives with multiple subtitles add choices to the list. MOA validates, converts, and saves files through its regular subtitle upload path.

`moa.fetch` makes a GET through the MOA server. It sends no MOA cookies or authorization headers and does not follow redirects. Private, loopback, and link-local addresses are blocked by the existing DNS-pinned HTTP client. Declaring an origin does not bypass that policy. Only successful HTTP responses are returned; remote headers are not forwarded. Use `Response.text()`, `json()`, `blob()`, or `arrayBuffer()` to read the result.

### Import through an HTML tool

An HTML package needs the `subtitles.import` permission:

```html
<input id="subtitle" type="file" accept=".srt,.vtt,.ass,.smi,.zip,.7z,.rar">
<p id="status" role="status"></p>
<script>
  document.querySelector('#subtitle').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await moa.importSubtitles(file);
      document.querySelector('#status').textContent = 'Subtitle saved';
    } catch (error) {
      document.querySelector('#status').textContent = error.message;
    }
  };
</script>
```

## Isolation and limits

Both script and HTML packages execute in sandboxed browser iframes with same-origin access disabled. Scripts use a hidden iframe, so they do not need an interface. They cannot access MOA's DOM, cookies, local storage, or JavaScript state. Each instance uses a dedicated message channel. A restrictive Content Security Policy blocks direct fetches, external scripts, forms, and nested frames. Use the SDK for supported operations. This boundary does not prevent malicious code from exhausting browser resources or navigating its own frame.

| Resource | Limit |
| --- | --- |
| Installed plugins | 32 |
| Package JSON | 256 KiB |
| Script or HTML content | 200 KiB |
| Actions | 8, labels up to 60 characters |
| Allowed HTTPS origins | 10 |
| Profile storage per plugin | 16 KiB JSON object, up to 128 top-level properties |
| Notification | 200 characters, shown for 6 seconds |
| SDK requests per instance | Four at once, 30-second timeout |
| SDK network response | 4 MiB, 15-second timeout |
| Concurrent SDK network requests | One per profile/plugin, four server-wide |
| Uploaded file | 10 MiB |
| Individual decoded subtitle | 4 MiB |
| Imported subtitles per operation | 32 |

The SDK does not expose arbitrary MOA API calls, authentication material, filesystem paths, or server-side JavaScript execution.

## Template

The [standalone GitHub template](https://github.com/MixedSystem/moa-plugin-template) contains `manifest.json`, `plugin.js`, a standard-library build script, and an HTML subtitle-import example. The same source lives at `plugins/template` in MOA.

```sh
node plugins/template/build.mjs
node plugins/template/build.mjs examples/subtitle-helper
```

Install the generated package from `plugins/template/dist`. Change the plugin ID before publishing a separate plugin, increase its version for updates, document requested permissions, and include a license.
