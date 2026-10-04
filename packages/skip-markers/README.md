# @moa/skip-markers

외부 AniSkip 마커 조회와 FFmpeg/fpcalc 기반 로컬 반복 오디오 분석을 제공한다. fingerprint·비교·병합·캐시·process runner API는 `src/index.ts`에서 export한다. 로컬 파일 분석에는 별도 FFmpeg/Chromaprint 실행 파일과 읽기 권한이 필요하다.

가상 시즌의 반복 OP/ED 구간이나 합성 PCM으로 회귀를 검증한다. 외부 마커는 원영상의 판본·길이·회차와 다를 수 있고 반복 장면은 오탐할 수 있다. 낮은 신뢰도 결과를 확정 마커로 취급하지 않는다. [자막과 스킵](../../docs/SUBTITLES-AND-SKIP.md)을 참고한다.

```sh
corepack pnpm --filter @moa/skip-markers build
corepack pnpm --filter @moa/skip-markers test
```

기술 출처: [Chromaprint](https://acoustid.org/chromaprint), [AniSkip API](https://api.aniskip.com/api-docs), [AniList API](https://docs.anilist.co/guide/graphql/). 외부 API의 데이터 권리는 소프트웨어 라이선스와 별개다.
