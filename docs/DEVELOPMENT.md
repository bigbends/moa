# 개발과 검증

Node.js 22.13 이상, Corepack과 저장소의 고정 pnpm을 사용한다.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm -r --filter './packages/**' build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
node --test deploy/auth/server.test.mjs
node --test services/aniyomi-worker/*.test.mjs services/aniyomi-worker/browser/*.test.mjs
```

서버 개발 시 쓰기 가능한 `MOA_DATA_DIR`, 읽기 가능한 `MOA_MEDIA_ROOT`, 필요하면 `MOA_WEB_DIR`, `MOA_FFMPEG`, `MOA_FFPROBE`를 직접 지정한다. `corepack pnpm dev:server`와 `corepack pnpm dev:web`로 시작한다. 계정 헤더를 신뢰하는 개발 API를 외부에 열지 않는다. 기본 Compose의 인증 gateway를 쓰는 통합 개발은 [배포 문서](DEPLOYMENT.md)를 따른다.

테스트는 가상 작품·소스·ID, 인메모리 DB, 로컬 HTTP fixture와 직접 생성한 미디어를 사용한다. 개인 DB, 실서비스 응답, 확장 APK, 쿠키, 포스터, 자막을 fixture로 복사하지 않는다. 합성 영상 예:

```sh
mkdir -p data/verification
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=24 -f lavfi -i sine=frequency=440 \
  -t 12 -c:v libx264 -pix_fmt yuv420p -c:a aac data/verification/sample.mp4
```

브라우저·FFmpeg·JVM이 필요한 검증은 별도 준비가 필요하다. `deploy/tests/accounts-e2e.py`는 별도 Compose 프로젝트로 컨테이너를 시작하므로 운영 환경에서 무심코 실행하지 않는다. live 검증은 자신이 허가한 설치본에만 명시적으로 실행하며 기본 단위 테스트와 구분한다. 결과물은 ignored `data/`, `test-results/` 또는 저장소 밖의 private 디렉터리에 둔다.

API 타입은 `packages/shared/src/index.ts`, endpoint schema는 `apps/server/src/app.ts`가 기준이다. 새 기능은 계정·프로필 격리, 취소/timeout, 실패 시 기존 설치 보존처럼 사용자에게 의미 있는 동작을 검증한다. [기여 정책](../CONTRIBUTING.md)을 따른다.
