# @moa/server

Fastify/SQLite 서버다. 로컬 미디어 스캔, 카탈로그·프로필, 확장 호출, FFmpeg 재생, 메타데이터·자막·캐시를 연결한다. 재생은 직접 재생/remux/transcode를 판정하고 계정 소유 세션 URL을 발급한다.

[개발](../../docs/DEVELOPMENT.md), [API](../../docs/API.md), [배포](../../docs/DEPLOYMENT.md)를 참고한다. `MOA_DATA_DIR`는 쓰기 가능한 private 디렉터리, `MOA_MEDIA_ROOT`는 읽기 가능한 미디어 경로로 지정한다. 운영 DB를 개발 fixture로 복사하지 않는다.

```sh
corepack pnpm --filter @moa/server typecheck
corepack pnpm --filter @moa/server test
corepack pnpm --filter @moa/server build
```
