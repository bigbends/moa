# @moa/subtitles-ko

자막 제목/시즌/회차 매칭, 제작자 후보 조회, 파일 수집·ZIP 안전 검사, ASS/SRT/SMI/VTT 변환을 제공한다. `createSubtitleClient`, `resolveKoreanTitle`, `listCreators`, `searchSubtitles`, `fetchCreatorSubtitle`과 변환·추출 API를 export한다.

`SubtitleQuery`의 title/season/episode와 선택 aliases/episodeOffset으로 가상 작품이나 사용자가 확인한 항목을 지정한다. request timeout·abort signal·응답 크기 제한과 diagnostic callback을 제공한다. 외부 메타데이터와 제작자 페이지를 조회할 수 있으며 자동 제목 연결은 판본 일치를 보장하지 않는다. 특정 제작자나 사이트의 사용·호환성을 추천하지 않는다.

[자막과 외부 전송](../../docs/SUBTITLES-AND-SKIP.md)을 참고한다. 테스트는 직접 작성한 짧은 자막과 합성 ZIP/HTTP fixture를 사용한다.

```sh
corepack pnpm --filter @moa/subtitles-ko build
corepack pnpm --filter @moa/subtitles-ko test
```

온라인 연동은 Anissia의 제작자 메타데이터, AniList 제목 정보와 공개 자막 제작자 아카이브(카이란·Csora·Melody)를 대상으로 한다. 영상 스트리밍 사이트나 확장 저장소 목록이 아니다. `enableKairan`, `enableCsora`, `enableMelody`로 각 아카이브 조회를 끌 수 있다. 제작자 표시는 실제 배포처의 출처를 보존하기 위한 것으로, 파일 수집 성공이나 특정 작품·회차 제공을 보장하지 않는다. 운영 조회 기록·실제 첨부 파일은 테스트에 포함하지 않는다.

기존 조회에서 후보를 찾지 못하면 남은 검색 시간 안에서 작품 제목·시즌·회차로 네이버 블로그 검색을 최대 두 번 조회한다. Naver·Tistory·Blogger의 글을 최대 네 개 확인하며, 검색 결과의 제목뿐 아니라 실제 글과 첨부 파일에도 동일한 제목·시즌·회차 검사를 적용한다. 누적 회차를 쓰는 작품은 검색어에서 회차를 생략하고 글·첨부에서 상대 회차와 누적 회차를 검사한다. 읽을 수 있는 결과가 없거나 요청이 실패하면 진단을 남기며, 전체 검색의 기본 12초 제한은 늘리지 않는다.
