FROM node:22-bookworm-slim AS node-runtime
FROM ubuntu:26.04
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ca-certificates libgtk-3-0t64 libdbus-glib-1-2 libasound2t64 \
    libnss3 libx11-xcb1 libxt6 libgbm1 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/source-browser/package.json services/source-browser/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/source-browser/requirements.txt /app/services/source-browser/requirements.txt
RUN python3 -m venv /opt/browser-venv \
    && /opt/browser-venv/bin/pip install --no-cache-dir -r /app/services/source-browser/requirements.txt
ENV PATH="/opt/browser-venv/bin:${PATH}" \
    MOA_SOURCE_BROWSER_BINARY=/opt/camoufox/camoufox
# Exact tested release; verify bytes before extraction. Runtime downloads are disabled.
RUN test "$(dpkg --print-architecture)" = amd64
COPY services/source-browser/install-browser.py /app/install-browser.py
RUN python /app/install-browser.py && chmod -R a+rX /opt/camoufox
COPY services/source-browser /app/services/source-browser
# Reuse the current public-IP/DNS-pinning policy; do not fork or vendor it.
COPY services/aniyomi-worker/browser/proxy.mjs services/aniyomi-worker/browser/policy.mjs services/aniyomi-worker/browser/address.mjs /app/services/aniyomi-worker/browser/
COPY services/aniyomi-worker/NOTICE.md /app/services/aniyomi-worker/NOTICE.md
COPY LICENSE /app/LICENSE
RUN mkdir -p /run/moa-source-browser && chown 1000:1000 /run/moa-source-browser
USER 1000:1000
CMD ["node", "services/source-browser/server.mjs"]
