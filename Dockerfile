FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/extensions/package.json packages/extensions/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/subtitles-ko/package.json packages/subtitles-ko/package.json
COPY packages/skip-markers/package.json packages/skip-markers/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN corepack pnpm install --frozen-lockfile
COPY packages/extensions packages/extensions
COPY packages/shared packages/shared
COPY packages/subtitles-ko packages/subtitles-ko
COPY packages/skip-markers packages/skip-markers
COPY apps/server apps/server
COPY apps/web apps/web
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md apps/web/public/licenses/
COPY LICENSES apps/web/public/licenses/LICENSES/
COPY docs/THIRD-PARTY-SOURCES.md apps/web/public/licenses/docs/THIRD-PARTY-SOURCES.md
RUN corepack pnpm --filter @moa/extensions build && corepack pnpm --filter @moa/subtitles-ko build && corepack pnpm --filter @moa/skip-markers build \
    && corepack pnpm --filter @moa/server build && corepack pnpm --filter @moa/web build

FROM node:22-bookworm-slim AS runtime
# Jellyfin's own 7.x ffmpeg includes the Radeon VAAPI userspace drivers.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /usr/share/keyrings/jellyfin.gpg \
    && printf '%s\n' 'deb [signed-by=/usr/share/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian bookworm main' > /etc/apt/sources.list.d/jellyfin.list \
    && apt-get update && apt-get install -y --no-install-recommends jellyfin-ffmpeg7 libchromaprint-tools \
    && mkdir -p /data && chown node:node /data \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/packages/extensions ./packages/extensions
COPY --from=build /app/packages/subtitles-ko ./packages/subtitles-ko
COPY --from=build /app/packages/skip-markers ./packages/skip-markers
COPY --from=build /app/apps/web/dist ./web
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY LICENSES ./LICENSES
COPY docs/THIRD-PARTY-SOURCES.md ./docs/THIRD-PARTY-SOURCES.md
ENV NODE_ENV=production MOA_DATA_DIR=/data MOA_MEDIA_ROOT=/media MOA_WEB_DIR=/app/web \
    MOA_FFMPEG=/usr/lib/jellyfin-ffmpeg/ffmpeg MOA_FFPROBE=/usr/lib/jellyfin-ffmpeg/ffprobe \
    LIBVA_DRIVERS_PATH=/usr/lib/jellyfin-ffmpeg/lib/dri
EXPOSE 8795
USER node
CMD ["node", "apps/server/dist/index.js"]
