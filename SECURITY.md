# 보안 제보

이 저장소의 GitHub **Security → Advisories → Report a vulnerability**에서 private vulnerability reporting으로 제보한다. 영향받는 버전/커밋, 재현 절차와 최소한의 합성 증거를 포함한다. 실제 계정·API 키·쿠키·재생 세션 URL·미디어·DB는 첨부하지 않는다. private reporting이 아직 비활성화되어 있으면 비밀이나 재현 exploit을 공개 이슈에 올리지 말고, 해당 기능의 활성화만 요청한다.

보안 수정은 최신 main과 최신 릴리스를 우선 대상으로 한다. 이전 버전에 대한 별도 지원 기간은 약속하지 않는다.

확장은 제3자 실행 코드이며 특히 APK는 일반 JVM 코드를 실행한다. 신뢰하는 확장만 설치한다. 앱은 gateway의 인증 헤더를 신뢰하므로 앱/인증/worker 포트의 외부 우회 접근을 차단한다. HTTPS, 데이터·secret 권한과 백업은 설치 운영자가 관리한다. [구조](docs/ARCHITECTURE.md)와 [배포](docs/DEPLOYMENT.md)를 참고한다.
