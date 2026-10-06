# Per-source proxy and experimental source browser

The standalone Firefox service supplies HTML/JS callbacks to MOA's existing JS
source runtime. It does not replace the APK container or relay media. Default
installation is unchanged: this service runs only when its compose override is
explicitly included. Source preferences must also enable the browser for the
desired source; that preference defaults to false. A blank source proxy uses
MOA's global/default proxy. The host selects both source ID and proxy; extension
scripts cannot choose either.

The existing source settings screen has a **Connection** section below the
extension's own preferences:

- **Per-source proxy** (text): leave blank to inherit the server global proxy;
  otherwise enter an `http://`, `https://` or `socks5://` address. The value is
  stored separately from guest preferences and applies to source runtime calls,
  image fetches and remote playback. Repository and JS-code downloads retain the
  server default proxy. APK package downloads use the selected source proxy.
- **Use source browser - experimental** (boolean, opt-in, default off): shown only for
  non-APK JS sources and disabled when the server has no source-browser service
  configured. Only extensions that explicitly call the WebView API use it;
  ordinary HTTP requests are not automatically redirected through a browser.
  Enabling it requires the deploy override below.

The proxy option is also available for APK sources. Their existing WebView
implementation is unchanged. Without an override, existing requests continue
to use the server default proxy and JS browser support remains off.

```sh
docker compose -f compose.yaml -f compose.source-browser.yaml build moa moa-source-browser
docker compose -f compose.yaml -f compose.source-browser.yaml up -d
```

The override uses a separate local main-app image so startup cannot silently
pull an older published app without the browser client. It receives
`MOA_SOURCE_BROWSER_URL=http://moa-source-browser:8799` and
`MOA_SOURCE_BROWSER_SECRET_FILE=/run/moa-source-browser/token`. The service
creates a 0600 random token in a dedicated volume; MOA mounts it read-only.
For a bind mount, set `MOA_SOURCE_BROWSER_SECRET_PATH` to a directory writable
by UID 1000 and readable by the app. No host port or gateway route is added.
Stop using the override and disable source browser preferences to opt out.

`POST /evaluate` requires `Authorization: Bearer <token-file-value>` and JSON:

```json
{"scope":"host-issued-source-id","proxy":"","url":"https://example.com/","headers":{},"script":"document.title","timeoutMs":25000}
```

It returns `{ "result": <JSON> }` or `{ "error": "source_*" }`. Request body
is at most 512 KiB, response at most 4 MiB, and timeout at most 90 seconds.
The deadline includes upload, queueing, browser launch, navigation, challenge
waiting and evaluation. The existing guest JS bridge currently limits its
received result to 1 MiB even though the RPC transport permits 4 MiB.
Scripts may use the existing Flutter `setResponse` wrapper passed by MOA.

There are at most two in-memory contexts, keyed by host source ID and normalized
proxy. Each context evaluates one request at a time. Cookies survive between
requests in that context; no persistent cookie files are written. Idle contexts
close after 120 seconds; the browser closes when the final context closes.
Failures and client disconnects close the affected context. A bounded cleanup
deadline kills the engine process group if graceful context cleanup stalls.
The browser's parent/death guard and process-group cleanup cover descendants.

Each evaluation attaches a fresh existing `openSourceBrowserProxy` gate to its
stable loopback relay. Detached relays refuse all connections. End-of-request
detach destroys all sockets, and transport budgets reset (32 MiB / 512 requests).
The browser-facing relay listens only on container loopback without Basic auth:
INV 0.26.1 loses CONNECT authentication when route headers are overridden.
The relay authenticates to the attached policy gate, and external RPC requires
the shared token. Run this service in its dedicated container, not alongside
untrusted local processes. No relay port is published.
Production supports public HTTPS targets only. The unchanged Node gate checks
DNS results and connects to a validated IP, including redirects/subresources;
route-time DNS checks alone would not provide this pinning. Ordinary ancillary
connection failures do not reject a verified DOM result, while address/URL and
body-limit failures remain closed. Private targets are used only by injected
localhost test gates, never by production configuration.

Media requests, common video/audio/manifest extensions and popups are blocked;
essential HTML/player/challenge iframes remain allowed. Injected request headers
apply only to the initial target origin. Cloudflare interstitials are waited out,
with locator-based checkbox interaction when offered; challenge state is checked
before and after callback evaluation and is never returned as successful HTML.
Browser fetching is for HTML/URL extraction; MOA's existing media relay handles
playback. WebSocket connection-limit pref effectiveness has not been separately
verified; INV's unsupported WebSocket routing API is deliberately not used.

The image pins InvisiblePlaywright 0.26.1, invisible-core 36.32.0 and the sealed
Linux amd64 Firefox 151.0 / firefox-36 engine. `INVPW_TRUE_HEADLESS=1` is forced.
Build-time fetching verifies the upstream seal; runtime requires an installed
binary and never downloads an engine. Full source/license provenance is in
[NOTICE.md](../services/source-browser/NOTICE.md).

The recipe uses Ubuntu 26.04 for the engine's newer NSS symbols ([package
version](https://packages.ubuntu.com/resolute/libnss3)), with Node 22 copied from
the official Node image. The full Docker image build was not run during this
implementation; compose configuration validation passed. The feature remains
experimental until the image build and startup are verified in the deployment
environment.

The launcher uses explicit `ko-KR` / `Asia/Seoul` so startup performs no direct
Python egress/geo probe. It disables WebRTC, DoH and prefetch/speculative
connections and configures a closed global browser proxy. Each context overrides
it with the loopback relay to the authenticated gate. True headless and
humanization are enabled; COOP/COEP preferences are disabled. Site compatibility
and challenge completion are not guaranteed.

INV rejects both `service_workers="block"` and WebSocket routing, and disabling
`dom.serviceWorkers.enabled` also disables HTTP route interception. The service
therefore leaves that engine pref enabled and installs a nonconfigurable
`navigator.serviceWorker=undefined` initialization script in every frame before
navigation. This blocks registration while preserving media/header routing,
but is detectable and may affect site compatibility. Transport pinning does not depend on this script.

Validation without any browser installation:

```sh
node --test services/source-browser/tests/*.test.mjs
python3 -m unittest discover -s services/source-browser/tests -p 'test_*.py'
docker compose -f compose.yaml -f compose.source-browser.yaml config --quiet
```

For the two opt-in localhost checks, use an existing INV venv and set
`MOA_SOURCE_BROWSER_BINARY` to its seal-verified Firefox path and
`XDG_CACHE_HOME` to its existing cache. Run `tests/proxy-api.py` for Basic CONNECT,
loopback-bypass and effective service-worker checks, or `tests/rpc-smoke.py` for
one complete authenticated RPC/DOM/context-reuse/idle-close check. The latter
injects local TLS trust and a local fixture gate only in test code. No real site,
video downloads, new engine downloads, or production environment are involved.
The full localhost RPC smoke passed with the real Firefox engine, including
Referer delivery, context reuse and idle cleanup.

Startup/errors log fixed public error codes only. Raw child diagnostics are
discarded by the gate; tokens, cookies, scripts, proxy details and URLs are not
logged. Authenticated `/health` checks RPC readiness, not site reachability or
Cloudflare completion.
