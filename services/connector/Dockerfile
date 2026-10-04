FROM cloudflare/cloudflared:2026.3.0@sha256:6b599ca3e974349ead3286d178da61d291961182ec3fe9c505e1dd02c8ac31b0 AS cloudflared
FROM tailscale/tailscale:stable@sha256:c507f3a2a6ab1cabd8d809b98edeb41edbd5c3fb6ad9632ffd098b4c7d0b4065 AS tailscale
FROM node:24-alpine
RUN apk add --no-cache ca-certificates && mkdir -p /data /run/moa-connector && chown -R node:node /data /run/moa-connector
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
WORKDIR /app
COPY server.mjs LICENSE NOTICE ./
COPY licenses ./licenses
USER node
CMD ["node", "server.mjs"]
