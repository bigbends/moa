# 설치 UI 계약

## 첫 관리자

- `GET /__moa/login`: 계정이 없으면 303 `/__moa/setup`.
- `GET /__moa/setup`: 계정이 없을 때 HTML 200과 CSRF 쿠키. 이미 계정이 있으면 404.
- `POST /__moa/setup`: `application/x-www-form-urlencoded`. 필드 `csrf`, `code`, `username`, `password`, `confirm`, 선택 `remember=on`.
- 코드는 앞뒤 공백 제거·대문자 변환 후 비교한다. 아이디는 앞뒤 공백 제거·소문자 변환 후 `[a-z0-9._-]{2,32}`. 비밀번호는 8~1024자.
- 성공: 첫 admin 계정 생성, 코드 삭제, 세션 쿠키 발급, 303 `/__moa/continue?next=%2F` → `/`. 일반 로그인과 같은 세션·CSRF·Secure-cookie 로직을 사용한다.
- 실패: 같은 HTML을 해당 HTTP 상태로 다시 표시한다. `#setup-error[data-error]`에 안정적인 오류 코드를 제공한다. 비밀번호와 설정 코드는 다시 표시하지 않는다.

| 상태 | data-error |
| --- | --- |
| 400 | `invalid-setup-code`, `invalid-username`, `invalid-password`, `password-mismatch` |
| 403 | `csrf-required` |
| 409 | `already-set-up` (동시 요청 중 다른 요청이 먼저 성공) |
| 429 | `too-many-attempts`, `Retry-After: 900` |

동일 IP는 인증 시도를 15분당 8번 할 수 있다. 로그인·가입 제한을 공유하며 동시에 해시를 검증하는 요청은 최대 4개다. 재시작 시 메모리의 제한은 초기화된다. 잘못된 미디어 타입은 415, 너무 큰 본문은 413 JSON 오류를 반환한다.

스타일링 대상: `deploy/auth/setup.html`. `#setup`, `#setup-form.setup-form`, `#setup-error.error`, 입력 `#code`, `#username`, `#password`, `#confirm`, `#remember`, 버튼 `#setup-submit`. 템플릿 변수 `CSRF`, `USERNAME`, `ERROR`, `ERROR_CODE`는 HTML escape된다. 기존 CSP는 외부 same-origin CSS/JS만 허용하므로 inline script/style 대신 정적 asset 등록을 사용한다.

## TMDB 관리자 설정

`GET /api/admin/tmdb/config`와 `PATCH /api/admin/tmdb/config`는 관리자 전용이며 프로필 헤더가 필요 없다. gateway 세션 인증과 기존 앱 API 보호를 사용한다. 응답은 `Cache-Control: private, no-store`이고 실제 키를 포함하지 않는다.

PATCH JSON은 다음 중 **하나만** 보낸다.

```json
{"token":"TMDB_READ_ACCESS_TOKEN"}
```

```json
{"apiKey":"0123456789abcdef0123456789abcdef"}
```

```json
{"clear":true}
```

Token은 16~4096자의 영문·숫자·점·밑줄·하이픈, API key는 32자리 hex다. 저장은 기존 DB credential을 교체한다. clear는 DB credential만 삭제한다. 환경변수에 token 또는 key가 있으면 환경변수 설정 전체가 우선하고, token이 key보다 우선한다.

GET/PATCH 200 응답 예:

```json
{"configured":true,"source":"database","credentialType":"token","hasSavedCredential":true}
```

`source`: `environment | database | none`. `credentialType`: `token | apiKey | null`. `configured`는 키 존재 여부이며 원격 API 유효성 검증 결과가 아니다. `hasSavedCredential`은 환경변수 override 중에도 DB 키 존재 여부를 보여준다. 저장 후 새 요청부터 바로 적용되며 진행 중인 요청은 이전 키를 사용할 수 있다. 기존 `GET /api/metadata/status`의 `{ "tmdb": boolean }`도 현재 활성 상태를 반영한다.

오류 JSON `{ "error": "..." }`: 400 `invalid-request`, 401 `login-required`, 403 `admin-required`. 키는 DB에 저장되므로 데이터 백업도 비공개로 관리한다.
