# Website plugins

Website plugins add tools to MOA's settings and player interface. They are separate from video-source extensions: they do not register a media catalog or playback source. A plugin can render its own HTML interface, read the current playback context when permitted, and import subtitles through MOA's normal server storage.

## Installation and management

Administrators install a JSON package under **Settings → Website plugins**. The preview shows its name, description, permissions, and allowed network origins before installation. Administrators can update, disable, or delete installed plugins. Other profiles can open enabled tools but cannot install or change them.

Packages are stored in MOA's database and survive server restarts. Updating the same ID replaces the package and preserves its enabled setting. Close and reopen a tool after updating it. Disabling or deleting a plugin prevents new SDK requests; it does not delete subtitles the plugin already imported.

Only install packages from authors you trust. Plugins execute their own JavaScript, can consume browser resources, and receive the information granted by their permissions.

## Package format

```json
{
  "apiVersion": 1,
  "id": "subtitle-helper",
  "name": "Subtitle helper",
  "version": "1.0.0",
  "description": "Import subtitles for the current episode.",
  "placements": ["player", "settings"],
  "permissions": ["player.context", "subtitles.import"],
  "connect": [],
  "html": "<button id='run'>Show episode</button><p id='result'></p><script>document.querySelector('#run').onclick = async () => { const context = await moa.context(); document.querySelector('#result').textContent = context?.title || 'Open this tool in the player'; };</script>"
}
```

All fields are required. Unknown fields and unsupported API versions are rejected. `id` must start with a lowercase letter and contain 2–64 lowercase letters, digits, or hyphens. `version` uses `major.minor.patch` with an optional prerelease suffix.

`placements` contains `settings`, `player`, or both. `player` adds a button under the subtitle and audio menu. `settings` adds an Open button in the website plugins section. Plugins only run when a user opens their tool.

`html` contains the interface, inline styles, and inline scripts. Bundle dependencies into the HTML before distribution. There is no automatic dependency loader or background process.

## Permissions and SDK

MOA supplies `window.moa` before the plugin HTML runs. Its asynchronous methods return promises and reject with an error when permission, input validation, or a server request fails.

| Method | Permission | Result |
| --- | --- | --- |
| `moa.context()` | `player.context` | `{ episodeId, title, currentTime }`, or `null` outside the player |
| `moa.importSubtitles(file)` | `subtitles.import` | `true` after successful import and server storage |
| `moa.fetch(url)` | Exact HTTPS origin in `connect` | A browser `Response` containing the downloaded bytes |

The context exposes the current episode ID, display title, and playback position in seconds. It does not expose source credentials, video URLs, account details, or API keys. A request outside the declared permissions is rejected even if the plugin calls the SDK method directly.

### Import a local file

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

Import requires an open player. Supported formats are SRT, VTT, VVT, ASS, SSA, SMI, SAMI, ZIP, 7z, and RAR. A single subtitle is selected automatically; archives with multiple subtitles add them to the selection list. The server validates and converts files using the same path as MOA's file picker.

### Load subtitles from a service

Add the service's exact origin to the manifest:

```json
"connect": ["https://subtitles.example.org"]
```

Use the SDK to download and import a file:

```js
const context = await moa.context();
if (!context) throw new Error('Open a video first');
const url = new URL('/download', 'https://subtitles.example.org');
url.searchParams.set('title', context.title);
const response = await moa.fetch(url.href);
const file = new File([await response.arrayBuffer()], 'downloaded.srt');
await moa.importSubtitles(file);
```

`moa.fetch` performs a GET through the MOA server. It sends no MOA cookies or authorization headers and does not follow redirects. Private, loopback, and link-local addresses are blocked by MOA's existing DNS-pinned HTTP client. An origin declaration is not an exception to that address policy. Only successful HTTP responses are returned; response headers are not forwarded. `Response.text()`, `json()`, `blob()`, and `arrayBuffer()` can decode the returned body.

## Isolation and limits

Each tool runs in a sandboxed iframe with scripts enabled and same-origin access disabled. Plugins cannot read MOA's DOM, cookies, local storage, or JavaScript state. The host communicates over a dedicated message channel. A restrictive Content Security Policy blocks direct fetches, external scripts, forms, and nested frames; use the SDK for supported operations. This is a browser boundary, not a guarantee against malicious code exhausting CPU or navigating its own frame. Reopening the tool restores its installed document.

| Resource | Limit |
| --- | --- |
| Installed plugins | 32 |
| Package JSON | 256 KiB |
| HTML content | 200 KiB |
| Allowed HTTPS origins | 10 |
| SDK network response | 4 MiB, 15-second timeout |
| Concurrent SDK network requests | One per profile/plugin, four server-wide |
| Uploaded file | 10 MiB |
| Individual decoded subtitle | 4 MiB |
| Imported subtitles per operation | 32 |

The SDK deliberately does not expose arbitrary MOA API calls, authentication material, filesystem paths, or server-side JavaScript execution.

## Start from the template

The [subtitle helper template](../plugins/template/README.md) separates its manifest and HTML for editing. Its build script produces the installable JSON using only Node.js standard-library functions:

```sh
node plugins/template/build.mjs
```

Change the plugin ID before publishing a separate plugin. Increase its version when distributing an update, document every requested permission, and include installation instructions and a license with your source.
