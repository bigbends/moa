# Java/Kotlin bytecode and its smoke tests run natively once for all targets.
FROM --platform=$BUILDPLATFORM maven:3.9-eclipse-temurin-21 AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY services/aniyomi-worker/build.py services/aniyomi-worker/pom.xml services/aniyomi-worker/dependencies.lock.json ./
COPY services/aniyomi-worker/java/ ./java/
COPY services/aniyomi-worker/kotlin/ ./kotlin/
COPY services/aniyomi-worker/test/ ./test/
RUN --mount=type=cache,target=/root/.m2 python3 build.py
FROM eclipse-temurin:21-jre-jammy AS jre
FROM node:22-bookworm-slim AS runtime
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="/opt/java/openjdk/bin:${PATH}"
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/moa-browser
WORKDIR /app
COPY services/aniyomi-worker/browser/package*.json ./browser/
RUN npm ci --omit=dev --prefix browser && node browser/node_modules/patchright/cli.js install --with-deps chromium \
    && apt-get install -y --no-install-recommends fontconfig fonts-nanum util-linux \
    && npm cache clean --force && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 10001 moa && useradd -u 10001 -g moa -m moa && mkdir -p /data /run/moa-apk && chown moa:moa /data \
    && chown 10001:1000 /run/moa-apk && chmod 2750 /run/moa-apk
COPY --from=build /src/build/target/apk-worker-0.1.0.jar ./build/target/apk-worker-0.1.0.jar
COPY --from=build /src/build/dependencies ./build/dependencies
COPY --from=build /src/build/build-inventory.json /src/build/UPSTREAM-LICENSE /src/build/ANIYOMI-LICENSE ./build/
COPY --from=build /src/build/src ./build/src
COPY --from=build /src/build/pom.xml ./build/pom.xml
COPY services/aniyomi-worker/*.mjs ./
COPY services/aniyomi-worker/scripts ./scripts
COPY services/aniyomi-worker/browser/*.mjs ./browser/
COPY services/aniyomi-worker/LICENSES ./LICENSES
COPY services/aniyomi-worker/NOTICE.md ./NOTICE.md
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./project-notices/
COPY LICENSES ./LICENSES
COPY docs/THIRD-PARTY-SOURCES.md ./project-notices/THIRD-PARTY-SOURCES.md
USER moa
ENV MOA_APK_DATA=/data
CMD ["node", "cli.mjs"]

FROM runtime AS verification
COPY --from=build /src/build/test-classes /app/test-classes
FROM runtime AS release
