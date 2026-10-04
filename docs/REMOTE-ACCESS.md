# Remote access backend and UI contract

The optional connector is included in `compose.yaml` and stays idle until an admin starts it. The app API has **no published host port**. All tunnels must use the login gateway. Never publish port 8795 or configure a tunnel to `moa:8795`.

## Admin API

Types: `packages/shared/src/remote-access.ts`, re-exported from `@moa/shared`.

| Method | Path | JSON body | Result |
| --- | --- | --- | --- |
| GET | `/api/admin/remote-access` | none | `RemoteAccessStatus` |
| POST | `/api/admin/remote-access/configure` | `RemoteAccessConfigure` | `RemoteAccessStatus` |
| POST | `/api/admin/remote-access/start` | `{}` | `RemoteAccessStatus` |
| POST | `/api/admin/remote-access/stop` | `{}` | `RemoteAccessStatus` |

All routes require an admin account; no profile header is needed. Mutations require `Content-Type: application/json`. Browser Origin must match the current host and forwarded scheme. Responses use `Cache-Control: private, no-store`. Existing API error shape is `{ "error": "code" }`.

Configure requires `mode`: `off`, `cloudflare-quick`, `cloudflare-token`, or `tailscale`. Optional fields are `publicHostname` (hostname only, without scheme/path/port), `funnel` (boolean), `cloudflareToken`, and `tailscaleAuthKey`. Omitted fields retain their saved values; `null` clears a secret. Never submit the returned `********` mask. Configure reapplies settings when already enabled; start enables the saved mode; stop disables it while retaining credentials. Mode `off` also disables it. Changing modes stops the previous process first. Stop can take up to two seconds while terminating a process.

Example mock response:

```json
{
  "mode": "tailscale",
  "state": "needs-login",
  "url": null,
  "urls": [],
  "loginUrl": "https://login.tailscale.com/a/example",
  "funnel": false,
  "lastError": null,
  "externallyManaged": false,
  "available": true,
  "desiredEnabled": true,
  "gatewayServiceUrl": "http://moa-gateway:8080",
  "warning": null,
  "config": {
    "mode": "tailscale",
    "publicHostname": "",
    "funnel": false,
    "cloudflareToken": null,
    "tailscaleAuthKey": null
  }
}
```

`state` is `off | starting | needs-login | connected | error`. `url` is nullable and `urls` is currently either empty or `[url]`. `loginUrl` is the Tailscale authorization link, not the app URL. Display a QR only for an available app URL (prefer `connected`). The web page renders QR codes with `uqr`.

Poll GET every 2–5 seconds while the page is visible. The controller reconciles every 15 seconds, so allow that delay after Tailscale authorization or a network change. Start/configure returns the current state, not necessarily `connected`. Quick Tunnel URLs change when the process restarts. Named tunnel `connected` means cloudflared registered a connection; it does not verify the dashboard hostname/DNS route. `funnel` reports the requested setting; only `connected` confirms Serve configuration succeeded. `warning` contains English public-access warning text for Quick Tunnel, token tunnels, and Funnel; the UI may localize it.

`available=false` means no connector configured or external management. `externallyManaged=true` disables mutations (409 `remote-access-externally-managed`). Other errors: 503 `connector-unavailable`, 409 `login-gate-and-admin-required`, 400 `invalid-public-hostname`, `invalid-secret`, or `cloudflare-token-and-hostname-required`. Runtime failures appear as fixed `lastError` codes (`connector-unavailable`, `connector-operation-failed`, `connector-process-failed`, `connector-process-exited`, `login-gate-and-admin-required`); process logs and credentials are never returned.

## Deployment and security

- `moa-connector` has cloudflared and Tailscale, an authenticated internal RPC on 8798, no host port, no Docker socket, no capabilities, and no TUN device. It runs as UID/GID 1000. A separate connector network contains only the connector and gateway, so dashboard ingress cannot bypass login by addressing the app API. The server reaches RPC through an unpublished gateway relay on 8798; the connector still authenticates every request. `moa-connector-data` stores Tailscale identity (override with `MOA_CONNECTOR_DATA_PATH`). `moa-connector-secret` stores the generated RPC token (override with `MOA_CONNECTOR_SECRET_PATH`), mounted read-only into app and auth.
- The server stores desired state and credentials in `/data/remote-access.json`, atomically written with mode 0600. These are plaintext secrets protected by filesystem permissions; protect backups too. Connector credential files also use 0600 and are removed on stop. RPC token uses 0640. No token appears in child command arguments or status responses.
- Compose supplies `MOA_CONNECTOR_URL=http://moa-gateway:8798`, `MOA_CONNECTOR_SECRET_FILE=/run/moa-connector/token`, and auth `MOA_TRUST_GATEWAY=1`. For a custom deployment, omit the URL and connector service to disable the feature; auth only trusts forwarded protocol when explicitly enabled. Keep auth and RPC ports private.
- `compose.tunnel.yaml` sets `MOA_REMOTE_EXTERNALLY_MANAGED=1` on the server. Existing static cloudflared configuration remains untouched. Existing bind-based installations must preserve their data paths with the variables in [the migration guide](SETUP-REMOTE-MIGRATION.md). This change does not deploy anything.
- Every enable/reconcile checks `MOA_REQUIRE_ACCOUNT=1`, auth's authenticated internal assertion that an enabled admin exists, and an unauthenticated request to gateway `/api/me` returning 401. Failure stops the connector. The connector lease expires after 45 seconds without server renewal. The gate check applies to tailnet-only access too.
- Forwarded protocol is normalized to `http`/`https`; gateway passes the actual Host. Cloudflare provides `X-Forwarded-Proto`; the local Tailscale proxy sets HTTPS. The default gateway listener accepts dynamic hosts. Auth selects `__Host-moa_*; Secure` on HTTPS and ordinary `moa_*` cookies on HTTP, reads either name during migration, and requires same-origin CSRF. Redirects remain local relative paths. `PUBLIC_HOST` and `PUBLIC_ORIGIN` remain compatible defaults; `PUBLIC_SCHEME` no longer controls cookies or forwarded protocol.
- `GATEWAY_CLIENT_IP` remains configurable and defaults to `$remote_addr`. Use `$http_cf_connecting_ip` only when every ingress is trusted Cloudflare traffic. With mixed LAN/Tailscale access, leave the default or supply a separately trusted proxy configuration. Login already limits eight attempts per IP per 15 minutes and four concurrent password verifications; successful login clears that IP's failure counter. Proxy IP sharing can cause users to share a limit.

## Provider requirements and limits

Cloudflare Quick Tunnel needs no account and is temporary; its URL is parsed from cloudflared output. For a connector token, configure the dashboard public hostname to **HTTP `moa-gateway:8080`**, paste the token, and enter that hostname in MOA. The dashboard remains authoritative; MOA cannot validate or repair its ingress rules. Never point dashboard routes to the app API or other internal services.

Tailscale runs in userspace networking mode. Complete the login link or supply an optional auth key. Serve proxies HTTPS to a loopback HTTP proxy fixed to the gateway. It requires tailnet HTTPS/MagicDNS and client access to the tailnet. Funnel additionally needs tailnet policy permission and Tailscale's eligibility/port restrictions; errors are reported without exposing CLI output. Stop terminates tailscaled but retains its device identity; remove/revoke that device in Tailscale to disconnect it permanently. Auth keys are retained securely for restart, so omit them after interactive enrollment unless unattended enrollment is intended. No account-backed Cloudflare or Tailscale end-to-end test is performed automatically.

References: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/), [token files](https://developers.cloudflare.com/tunnel/reference/run-parameters/), [Tailscale userspace networking](https://tailscale.com/docs/concepts/userspace-networking), [Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), [Funnel](https://tailscale.com/docs/reference/tailscale-cli/funnel).

## Validation

Run `node --test deploy/auth/server.test.mjs deploy/gateway/config.test.mjs services/connector/server.test.mjs` and `corepack pnpm --filter @moa/server exec tsx --test test/remote-access.test.ts test/accounts.test.ts test/api.test.ts`. Build workspace dependency packages before server typecheck/build. Build the connector with `docker build -t moa-connector:remote-access services/connector`.

Smoke tests must use a separate Compose project, dummy gateway/backend, no published app/RPC ports, and remove containers/network/volumes afterward. Never use the production shared checkout.

Remote-access feature validation before integration: six auth/gateway/connector unit tests and five controller/API/account tests passed; server build and shared typecheck passed; connector image built locally. An isolated dummy Compose project passed `nginx -t`, returned 401 for unauthenticated gateway API requests, passed authenticated RPC through the private relay, and confirmed the connector cannot resolve the app service. Tailscale reached `needs-login` with an authorization URL and stopped cleanly. One real Quick Tunnel reached `connected`, but its public fetch failed with DNS `ENOTFOUND`; external reachability is therefore unverified. No second Quick Tunnel was created. All smoke containers, networks, and volumes were removed. No production checkout or deployment was used.
