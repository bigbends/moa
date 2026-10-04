# @moa/extensions

사용자가 선택한 Mangayomi 형식 JavaScript를 QuickJS 프로세스에서 실행하는 영상 source 호환 패키지다. 저장소 목록 파싱과 `getVideoList` 등 source 호출, filter/preference 변환, 공개 네트워크 HTTP와 outbound proxy를 제공한다. 원래 앱 전체의 호환성을 보장하지 않는다.

기본·추천 저장소는 제공하지 않는다. 호출자는 직접 선택한 repository URL과 설치 entry를 전달한다. APK는 별도 worker가 담당한다. [사용법과 신뢰 경계](../../docs/EXTENSIONS.md), [출처와 변경 고지](NOTICE.md)를 참고한다.

```sh
corepack pnpm --filter @moa/extensions build
corepack pnpm --filter @moa/extensions typecheck
corepack pnpm --filter @moa/extensions test
```

테스트에는 중립 URL·로컬 HTTP 서버·합성 source를 사용한다. 다운로드한 코드·preference·쿠키·검증 출력은 private 데이터로 보관한다.
