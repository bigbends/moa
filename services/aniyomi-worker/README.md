# Aniyomi APK worker

사용자가 설치한 APK의 영상 source API 일부를 별도 JVM에서 실행한다. API14/API16 manifest 검증, DEX 변환, source/filter/preference RPC, 자산·쿠키 저장과 선택 Chromium WebView 브리지를 제공한다. Android emulator나 원래 앱 UI는 포함하지 않는다.

[Docker 설치](../../docs/DEPLOYMENT.md)의 `compose.aniyomi.yaml`을 선택하고 private 공유 token을 준비한다. RPC는 내부 8797 포트만 사용한다. APK·변환 JAR·preference는 named volume에 저장한다. 기존 volume과 token을 업데이트 때 보존한다.

APK는 일반 JVM 코드다. read-only root, cap-drop, no-new-privileges와 자원 제한은 완전한 격리가 아니다. 신뢰한 확장만 설치하며 worker를 외부에 노출하지 않는다. WebView에는 공개 IP 검사·연결/페이지/시간 제한과 확장별 저장 경계가 있다. 모든 Android API·네트워크 동작을 지원하지 않는다.

빌드는 `build.py`, `pom.xml`, `dependencies.lock.json`의 고정 소스와 JAR 해시를 사용한다. Java 21/Maven/Python과 브라우저 의존성이 필요하다. 브라우저 package lock은 pnpm workspace와 별개다.

```sh
node --test services/aniyomi-worker/*.test.mjs services/aniyomi-worker/browser/*.test.mjs
```

합성 WebView·source fixture를 사용한다. 실제 저장소 URL·다운로드한 APK·영상·계정 값을 테스트에 추가하지 않는다. [출처 고지](NOTICE.md), [대응 소스](../../docs/THIRD-PARTY-SOURCES.md)를 참고한다.
