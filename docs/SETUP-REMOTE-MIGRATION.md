# Existing deployment: setup and remote-access migration

This is a migration procedure, not a record of a production deployment. The integration was tested with synthetic configuration and throwaway data. Never copy test credentials into an existing installation.

## Preserve the current storage

Before using the updated compose files, add these **required** bindings to the existing production `.env` if it currently uses `./data`:

```dotenv
MOA_DATA_PATH=./data
MOA_AUTH_DATA_PATH=./data/auth/sessions
MOA_AUTH_CONFIG_PATH=./data/auth/config
```

Without these variables, the new defaults create empty named volumes and the application would appear to have lost its data/accounts. Do not move or rename the existing application DB, authentication `sessions.sqlite` (and its WAL/SHM), or `credentials.json`.

For the new connector, choose either the default named volumes (no extra variables or directory preparation) or the following **optional** bind paths to keep its state in `./data` as well:

```dotenv
MOA_CONNECTOR_DATA_PATH=./data/connector
MOA_CONNECTOR_SECRET_PATH=./data/connector-secret
```

For that bind option, prepare only the new directories before first start, from the deployment checkout:

```sh
sudo install -d -m 0700 -o 1000 -g 1000 data/connector data/connector-secret
```

The connector generates its own RPC token. Do not invent a token, copy the APK token, or change ownership recursively on existing data. The two paths must be consistent across services; compose supplies the same secret path to app, auth, and connector. App/auth/connector run as UID 1000; the APK worker retains its own UID and existing token permissions.

## Keep the existing environment and project identity

Keep the current values of:

- `COMPOSE_FILE=compose.yaml:compose.aniyomi.yaml:compose.vaapi.yaml:compose.tunnel.yaml`
- `PUBLIC_HOST`, `PUBLIC_ORIGIN`, `PUBLIC_SCHEME`, `GATEWAY_CLIENT_IP` (if configured)
- `MEDIA_PATH`, `MEDIA_CONTAINER_PATH`, gateway binding/port, and transcoding settings
- all VAAPI/device/group settings, `TUNNEL_UID`, `TUNNEL_GID`, `CF_TUNNEL_CONFIG_FILE`, `CF_TUNNEL_CREDENTIALS_FILE`
- `MOA_APK_TOKEN_FILE`, the existing APK named volume, and TMDB environment credentials

Use the same Compose project name (`-p`, `COMPOSE_PROJECT_NAME`, or the existing checkout directory name), so the APK volume and service identity are retained. `MOA_PORT` is obsolete and may be removed. `MOA_VERSION` is optional; it defaults to `latest` and selects matching app/auth/APK/connector GHCR tags. Use a published immutable release tag when pinning. This integration branch does not itself publish images; the workflow publishes on main, version tags, or manual invocation.

The application gets `MOA_CONNECTOR_URL=http://moa-gateway:8798` and `MOA_CONNECTOR_SECRET_FILE=/run/moa-connector/token` from compose. Auth gets `MOA_TRUST_GATEWAY=1` and the secret-file path. Do not add these as public host endpoints. The static-tunnel overlay supplies `MOA_REMOTE_EXTERNALLY_MANAGED=1`; keep that overlay to preserve static-tunnel ownership.

## Changes when an operator later upgrades the stack

- Host port **8795 is removed**, including its loopback mapping. Use the gateway on the existing 8796 binding, or the existing HTTPS hostname. Update scripts/health checks that called the host's `localhost:8795`; container-internal health checks still use 8795. The API still trusts gateway identity headers and must never be published directly.
- A new `moa-connector` service and two persistent volumes/directories are created. It remains idle with the static tunnel overlay. The existing `moa-tunnel` config, credentials, and hostname are unchanged.
- Gateway joins an extra connector network. The connector cannot reach the app/auth network directly; authenticated control RPC uses an unpublished gateway listener on 8798. Only gateway 8080 is mapped to a host port.
- The hardcoded app container name is removed. Use `docker compose exec moa …`, not a fixed `docker exec moa …` name.
- Fresh installations show a setup code, but an existing account database does not enter setup and does not generate a new admin. No password reset, setup-code entry, data import, or secret rotation is required for an existing accounts-v1 installation.
- Existing unexpired **`__Host-moa_session` cookies remain valid over HTTPS**. The session token hash, account IDs, authentication database, and password hashes are preserved. The regression test seeds the pre-setup accounts-v1 schema and verifies the same HTTPS cookie across migration and two starts. Sessions still expire normally; disabled accounts or intentional password resets revoke them as before. Installations older than accounts-v1 retain the pre-existing one-time fingerprint-session invalidation behavior.
- Cookie security now follows each request: HTTPS uses `__Host-moa_*; Secure`, HTTP uses `moa_*`. Both names are accepted during transition. Preserve Host and send accurate `X-Forwarded-Proto`; Cloudflare does this, and the Tailscale proxy sets HTTPS. `PUBLIC_SCHEME` is retained for compatibility but no longer selects cookie security. HTTP and HTTPS access can coexist.
- TMDB credentials in the environment still take precedence over keys saved through the new admin editor. Existing app data, source/proxy settings, and accounts stay in their original storage.

## One-time operator sequence (not executed against production)

1. Take a consistent private backup of app/auth databases and private config, plus the existing APK volume/token. Use SQLite backup or stop writers before copying database files; preserve WAL state. Never use `down -v` on production.
2. Add the three required data bindings; optionally add/prepare the connector bind directories above. Keep all existing overlay/private file settings and the same project name.
3. Obtain the reviewed code and matching published images, or build the four images from that code. Validate with `docker compose config --quiet`. Do not print resolved configuration because it can contain credentials.
4. At the chosen maintenance window, the operator can run `docker compose pull` followed by `docker compose up -d`. For local builds use `docker compose build` then `docker compose up -d --pull never`. This recreates changed containers and briefly interrupts service; it is not a production action performed by the integration agent.
5. Check the existing HTTPS login/session, library and sources, playback/VAAPI/APK worker, and admin settings. Remote access should report externally managed while the static tunnel overlay is active. Confirm there is no host mapping for 8795 or 8798.

To roll back, restore the prior compose/code/images and retain the same bind paths/project name. Do not delete volumes. The new `auth_state` table is additive; the old accounts/session schema remains unchanged.

## Integration verification

On `feat/setup-remote`, all 334 tests passed: server 159, extensions 17, subtitles 88, skip-markers 18, worker Node suites 44, and auth/setup/migration/gateway/connector 8. Workspace typechecks and the web production build passed. The app, auth, APK worker, and connector images built locally; this does not claim an ARM-device test or a registry push.

Compose validation passed with no `.env` and with a synthetic production-like `.env` containing all four overlays plus existing-data and connector bind paths. Production configuration was not read or changed.

One default-compose smoke run used a separate project, temporary loopback gateway port, local image tags, no `.env`, and fresh named volumes. It verified the setup code was present in auth logs without printing it, the setup form created an admin and then closed, a fresh login succeeded, `/api/me` returned 200/admin through the gateway, the TMDB endpoint responded, and remote-access status returned `available=true`, `state=off`, `lastError=null`. The remote-access SPA route also responded. No tunnel was started. The stack was removed with `down -v`, including its networks and volumes.
