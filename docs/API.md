# API 개요

현행 타입은 `packages/shared/src/index.ts`, validation schema는 `apps/server/src/app.ts`를 따른다. 아래는 주요 경로이며 완전한 OpenAPI 명세는 아니다.

계정 gateway가 확인한 `X-Moa-Account`, `X-Moa-Role`, `X-Moa-Username`만 앱이 신뢰한다. 프로필을 사용하는 JSON API는 해당 계정 소유의 `X-Moa-Profile`이 필요하다. 이미지·발급된 재생 자산 URL은 브라우저의 헤더 없는 요청을 지원하되 세션 소유 계정을 검사한다. 오류는 일반적으로 `{ "error": "code" }`다.

| 영역 | 주요 경로 |
| --- | --- |
| 상태·프로필 | `GET /api/health`, `GET /api/me`, CRUD `/api/profiles` |
| 계정·초대 | `/__moa/api/…` (인증 서버) |
| 카탈로그 | `GET /api/home`, `/api/media`, `/api/search`, `/api/media/:id` |
| 작품 그룹 | `POST /api/media/groups/resolve`, `GET/PATCH /api/media/:id/group` |
| 시즌 | `GET /api/media/:id/franchise` |
| 저장소·확장 | `GET/DELETE /api/source-repositories`, `POST /api/sources/refresh`, `/api/sources/:id/install`, `/check`, `/rollback` |
| 확장 탐색 | `GET/POST /api/sources/:id/browse`, `GET/PATCH /preferences`, `GET /filters` |
| 로컬 라이브러리 | `/api/library/folders`, `/browse`, `/scan`, `/status` |
| 재생 | `POST /api/playback`, `POST /api/playback/:sessionId/heartbeat`, `DELETE /api/playback/:sessionId` |
| 자막·마커 | `/api/episodes/:id/subtitles/…`, `GET /api/episodes/:id/markers` |
| 번역 | `/api/translations/:id`, `/api/translation/config`, 관리자 `/api/admin/translation/…` |
| 캐시 진단 | `GET /api/admin/cache-stats` |

재생 생성은 `episodeId`, `capabilities`와 선택 `audioTrackId`, `streamId`, `startPosition`을 받는다. capability는 h264/hevc/av1과 선택 vp9/audioCodecs/maxHeight를 전달한다. 반환된 URL을 그대로 사용하고 sessionId를 외부에 공유하지 않는다. heartbeat와 자산 접근은 세션 수명을 갱신한다.

소스·메타데이터·라이브러리·전역 설정의 변경은 관리자 권한이 필요하다. 시청 기록·찜·개인 그룹 변경은 소유 프로필 범위다. 인증 서버의 JSON 변경 호출에는 동일 출처 Origin과 `X-Moa-Request: 1`이 필요하다. [계정](ACCOUNTS.md), [그룹](SEARCH-GROUPING.md)을 참고한다.
